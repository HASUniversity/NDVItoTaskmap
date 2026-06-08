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

import { state, defaultClasses } from './state.js?v=1';
import { toast, escapeHtml, showLoading, hideLoading, setLoadingDetail } from './utils.js?v=1';
import { map, gridOverlay, updateLayerVisibility } from './map.js?v=1';
import { drawNDVIHistogram, ndviToRGB, autoClassifyFromData, renderClassifiedNDVI } from './ndvi.js?v=1';
import { activateStep } from './steps.js?v=1';

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
  if (state.currentStep < 5) return;
  if (!document.querySelector('#step-5.active')) return;
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

// ==========================================
// STEP 2 → 4: Data Analyse (vanuit Percelen)
// ==========================================
const _gotoStep4Btn = document.querySelector('#goto-step4-btn');
if (_gotoStep4Btn) {
  _gotoStep4Btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!state.selectedParcels || state.selectedParcels.length === 0) {
      toast(t('toastSelectParcels'), true);
      return;
    }
    if (!state.ndviGrid) {
      toast(t('toastNoNDVI'), true);
      return;
    }
    activateStep(4);
  });
}

// ==========================================
// STEP 4 → 5: Taakkaart
// ==========================================
const _gotoStep5Btn = document.querySelector('#goto-step5-btn');
if (_gotoStep5Btn) {
  _gotoStep5Btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!state.selectedParcels || state.selectedParcels.length === 0) {
      toast(t('toastSelectParcels'), true);
      return;
    }
    // Herclassificeer met de gekozen methode voordat we naar de taakkaart gaan
    if (state.classificationMethod !== 'manual' && state.ndviHistogramData) {
      autoClassifyFromData();
    }
    // Stel automatisch de optimale rijrichting in als standaard
    const angle = computeOptimalGridAngle(state.selectedParcels);
    state.gridAngle = angle;
    if (gridAngleSlider) gridAngleSlider.value = angle;
    if (gridAngleValue) gridAngleValue.textContent = angle + '°';
    if (autoAngleHint) { autoAngleHint.textContent = tf('autoAngleHintAngle', angle); autoAngleHint.style.display = ''; }
    activateStep(5);
    // Toon de doserings-editor
    renderDosageEditor();
    // Genereer direct een taakkaart voor live preview
    try { generateTaskMap(); renderExportStats(); }
    catch (e) { console.warn('Vroege generate mislukt:', e); }
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

/**
 * Updates the unit description hint below the select element.
 * @param {string} unit - The selected unit value.
 */
function updateUnitHint(unit) {
  const hintEl = document.querySelector('#unit-hint');
  if (!hintEl) return;
  const hints = {
    'kg/ha':      '\u24D8 kg/ha \u2014 vaste meststoffen, kalk & korrel (standaard)',
    'g/ha':       '\u24D8 g/ha \u2014 sporenelementen, micro-granulaten & additieven',
    't/ha':       '\u24D8 t/ha \u2014 organische mest, compost & bulkproducten',
    'L/ha':       '\u24D8 L/ha \u2014 vloeibare meststoffen & gewasbescherming (standaard)',
    'mL/ha':      '\u24D8 mL/ha \u2014 geconcentreerde vloeistoffen & vloeibare additieven',
    'm\u00b3/ha': '\u24D8 m\u00b3/ha \u2014 drijfmest, gier & beregening (grote volumes)',
    'kg/m\u00b2':  '\u24D8 kg/m\u00b2 \u2014 zeer precieze dosering per vierkante meter',
    'L/m\u00b2':   '\u24D8 L/m\u00b2 \u2014 zeer precieze vloeistofdosering per m\u00b2',
    'zaden/ha':   '\u24D8 zaden/ha \u2014 variabel zaaien op basis van NDVI',
    'stuks/ha':   '\u24D8 stuks/ha \u2014 planten, pootgoed & bollen uitzetten',
    'doses/ha':   '\u24D8 doses/ha \u2014 biologische middelen, entingen & behandelingen',
    'eenheden/ha':'\u24D8 eenheden/ha \u2014 algemeen; zelf te defini\u00EBren eenheid',
  };
  hintEl.textContent = hints[unit] || '\u24D8 ' + unit;
}

// ==========================================
// CLASSIFICATION METHOD
// ==========================================
const classMethodSelect = document.querySelector('#class-method-select');
if (classMethodSelect) {
  // Initialise from state (in case the value was set before the DOM was ready)
  classMethodSelect.value = state.classificationMethod || 'quantile';

  classMethodSelect.addEventListener('change', function () {
    state.classificationMethod = classMethodSelect.value;
    if (state.classificationMethod === 'manual') {
      toast(t('toastClassifyManual'));
      renderClassifiedNDVI();
      return;
    }
    // Re-classify with the selected method
    if (state.ndviHistogramData) {
      autoClassifyFromData();
      liveRegenerate();
    } else {
      toast(t('toastNoNDVI'), true);
    }
  });
}

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
    '<span></span><span>' + t('clsName') + '</span><span>' + t('clsFrom') + '</span><span>' + t('clsTo') + '</span><span></span>' +
    '</div>';

  state.classes.forEach(function (cls, i) {
    const row = document.createElement('div');
    row.className = 'class-row';
    row.innerHTML =
      '<input type="color" class="class-color" value="' + cls.color + '" data-i="' + i + '">' +
      '<input type="text" value="' + escapeHtml(cls.name) + '" data-i="' + i + '" data-field="name">' +
      '<input type="number" step="0.01" value="' + cls.min + '" data-i="' + i + '" data-field="min">' +
      '<input type="number" step="0.01" value="' + cls.max + '" data-i="' + i + '" data-field="max">' +
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
      renderClassifiedNDVI();
      liveRegenerate();
    });
  });

  classesContainer.querySelectorAll('.remove-class').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.classes.splice(parseInt(btn.dataset.i), 1);
      renderClasses();
      renderClassifiedNDVI();
      liveRegenerate();
    });
  });

  renderDosageEditor();
  setTimeout(drawNDVIHistogram, 0);
}

addClassBtn.addEventListener('click', function () {
  const last = state.classes[state.classes.length - 1];
  state.classes.push({ name: tf('clsNewClass', state.classes.length + 1), min: last ? last.max : 0, max: 1, rate: 50, color: '#9e9e9e' });
  renderClasses();
  renderClassifiedNDVI();
});

const autoClassifyBtn = document.querySelector('#auto-classify-btn');
if (autoClassifyBtn) autoClassifyBtn.addEventListener('click', function () {
  autoClassifyFromData();
  renderClassifiedNDVI();
});

// Handle the auto-classify event dispatched by ndvi.js
window.addEventListener('ndvi:autoclassify', function () {
  renderClasses();
  renderClassifiedNDVI();
  liveRegenerate();
});

// ==========================================
// DOSAGE EDITOR (Step 5)
// ==========================================
const dosageContainer = document.querySelector('#dosage-container');

/**
 * Renders a compact dosage editor inside Step 5 (Taakkaart Instellen).
 * Shows each class with its colour swatch, name, and an editable dosage
 * input.  Changes trigger a live regenerate so the task map preview
 * updates immediately.
 */
export function renderDosageEditor() {
  if (!dosageContainer) return;
  // Only render the dosage editor when Step 5 (Taakkaart) is the active step
  if (!document.querySelector('#step-5.active')) return;

  // If no classes exist yet, show placeholder
  if (!state.classes || state.classes.length === 0) {
    dosageContainer.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">' + t('toastNoNDVI') + '</p>';
    return;
  }

  let html = '';
  state.classes.forEach(function (cls, i) {
    html +=
      '<div class="dosage-row">' +
        '<span class="dosage-color" style="background:' + cls.color + '"></span>' +
        '<span class="dosage-name">' + escapeHtml(cls.name) + '</span>' +
        '<div class="dosage-input-wrap">' +
          '<input type="number" step="1" min="0" value="' + cls.rate + '" data-i="' + i + '" class="dosage-input" />' +
          '<span class="dosage-unit-label">' + escapeHtml(state.unit ? state.unit.split('/')[0] : '') + '</span>' +
        '</div>' +
      '</div>';
  });
  dosageContainer.innerHTML = html;

  // Wire up change listeners
  dosageContainer.querySelectorAll('.dosage-input').forEach(function (inp) {
    inp.addEventListener('change', function () {
      const i = parseInt(inp.dataset.i);
      state.classes[i].rate = parseFloat(inp.value) || 0;
      renderClassifiedNDVI();
      liveRegenerate();
    });
    // Also update on input for live feel
    inp.addEventListener('input', function () {
      const i = parseInt(inp.dataset.i);
      state.classes[i].rate = parseFloat(inp.value) || 0;
    });
  });
}

// Re-render dosage editor when step 5 is activated (via header click or navigation)
window.addEventListener('step:activated', function (e) {
  if (e.detail && e.detail.step === 5) {
    renderDosageEditor();
  }
});

// Re-render dosage editor when the unit changes (updates the unit label)
unitSelect.addEventListener('change', function () {
  state.unit = unitSelect.value;
  updateUnitHint(unitSelect.value);
  if (document.querySelector('#step-5.active')) {
    renderDosageEditor();
  }
  liveRegenerate();
});

// ==========================================
// GENERATE TASK MAP
// ==========================================
generateBtn.addEventListener('click', function (e) {
  if (!state.selectedParcels || state.selectedParcels.length === 0) {
    toast(t('toastSelectParcels'), true); return;
  }
  e.stopPropagation();
  showLoading(t('loadingGenerate'));
  setLoadingDetail(state.gridSize + ' m grid \u00b7 ' + (state.selectedParcels.length) + ' percelen \u00b7 ' + state.classes.length + ' klassen');
  setTimeout(function () {
    try {
      generateTaskMap();
      hideLoading();
      toast(t('toastGenerated'));
      renderExportStats();
      activateStep(6);
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
        class: cls.name,
        dose: cls.rate,
        unit: state.unit,
        color: cls.color,
      };
      features.push(geoCell);
    }
  });

  state.taskMapFC = { type: 'FeatureCollection', features };

  gridOverlay.clearLayers();
  state.gridLayer = L.geoJSON(state.taskMapFC, {
    style: f => ({ fillColor: f.properties.color, fillOpacity: 0.7, color: '#ffffff', weight: 1, opacity: 0.8 }),
    onEachFeature: function (f, layer) {
      layer.bindPopup(
        '<b>' + f.properties['class'] + '</b><br>' +
        'NDVI: ' + f.properties.ndvi + '<br>' +
        'Rate: ' + f.properties.dose + ' ' + f.properties.unit
      );
    }
  }).addTo(gridOverlay);

  if (!map.hasLayer(gridOverlay)) map.addLayer(gridOverlay);
  const taakkaartCb = document.querySelector('.ulc-panel input[data-layer="taakkaart"]');
  if (taakkaartCb) taakkaartCb.checked = true;
  updateLayerVisibility();
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
    const k = f.properties['class'];
    if (!classCounts[k]) classCounts[k] = { count: 0, area: 0, color: f.properties.color, rate: f.properties.dose };
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
