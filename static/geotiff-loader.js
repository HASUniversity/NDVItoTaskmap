/* ===================================================
   geotiff-loader.js — GeoTIFF file loading & band selection UI

   Responsibilities:
     - Drag-and-drop / file-picker upload handler
     - Overview-aware raster reading at a target resolution
     - Band metadata parsing (wavelength, name, GDAL_METADATA XML)
     - Automatic band assignment for common sensor layouts
     - Band selector <select> population and VI-dependent visibility
     - Resolution slider with debounced reload
     - Compute button wiring
   =================================================== */

import { state, VEGETATION_INDICES, defaultClasses } from './state.js?v=1';
import { ensureEPSG, showLoading, hideLoading, toast, setLoadingDetail } from './utils.js?v=1';
import { escapeHtml } from './utils.js?v=1';
import { displayNDVI, displayRGB, zoomToGeoTIFF, autoClassifyFromData, clipNDVIToParcel, renderClassifiedNDVI } from './ndvi.js?v=1';
import { map, ndviOverlay, brpOverlay, selectionOverlay, gridOverlay, showLegendInPanel, updateLayerVisibility, clearLegendCrop } from './map.js?v=1';
import { startBRPLoading, stopBRPLoading, stopDrawing } from './brp.js?v=1';
import { activateStep } from './steps.js?v=1';

const { t, tf } = window;

// ==========================================
// DOM REFERENCES
// ==========================================
const geotiffInput    = document.querySelector('#geotiff-input');
const fileDrop        = document.querySelector('#file-drop');
const fileInfo        = document.querySelector('#file-info');
const redBandSel      = document.querySelector('#red-band');
const greenBandSel    = document.querySelector('#green-band');
const blueBandSel     = document.querySelector('#blue-band');
const nirBandSel      = document.querySelector('#nir-band');
const rededgeBandSel  = document.querySelector('#rededge-band');
export const viSelect = document.querySelector('#vi-select');
const viInfo         = document.querySelector('#vi-info');
const viFormula      = document.querySelector('#vi-formula');
const viDesc         = document.querySelector('#vi-desc');
const viDetails      = document.querySelector('#vi-details');
const computeBtn      = document.querySelector('#compute-ndvi-btn');
const stretchCheck    = document.querySelector('#stretch-ndvi');
const resolutionSlider = document.querySelector('#resolution-slider');
const resolutionValue  = document.querySelector('#resolution-value');

export { stretchCheck };

/**
 * Returns the pixel-dimension limit selected by the resolution slider.
 * The raster is scaled so that its largest dimension equals this value.
 * @returns {number} Pixel limit (dynamisch obv data).
 */
export function getRequestedResolution() {
  const requested = resolutionSlider ? parseInt(resolutionSlider.value, 10) : 2048;
  return isNaN(requested) ? 2048 : requested;
}

/**
 * Update the resolution slider's min/max/step based on the actual
 * GeoTIFF dimensions so the user can always select the full native
 * resolution — no more, no less.
 */
function updateResolutionSliderForData(fullW, fullH) {
  const maxDim = Math.max(fullW, fullH);
  // De step moet KLEIN genoeg zijn zodat de default-waarde een veelvoud is.
  // Forceren: max 64px per stap, of maxDim/100 (voor grote TIFs), wat het kleinst is.
  let step = Math.min(64, Math.max(1, Math.round(maxDim / 100)));
  // Afronden naar macht van 2 voor schone intervallen
  step = Math.pow(2, Math.round(Math.log2(step)));

  const min = Math.min(64, Math.max(step, Math.round(maxDim / 16)));
  const max = maxDim;

  resolutionSlider.min = min;
  resolutionSlider.max = max;
  resolutionSlider.step = step;

  // Kies een redelijke standaard-resolutie:
  // - maxDim < 2000 px (kleine TIF): 512
  // - maxDim 2000-5000 px: 1024
  // - maxDim > 5000 px (grote TIF): 2048
  let defaultRes;
  if (maxDim <= 2000) defaultRes = 512;
  else if (maxDim <= 5000) defaultRes = 1024;
  else defaultRes = 2048;
  // Zet de waarde direct (zonder step-snap, want step is nu <= defaultRes)
  if (defaultRes % step !== 0) {
    // Mocht defaultRes geen veelvoud zijn, neem dan het dichtstbijzijnde lagere veelvoud
    defaultRes = Math.floor(defaultRes / step) * step;
  }
  resolutionSlider.value = defaultRes;
  resolutionValue.textContent = defaultRes;
  console.log('[Slider] maxDim=' + maxDim + ' step=' + step + ' min=' + min + ' max=' + max + ' default=' + defaultRes + ' final=' + resolutionSlider.value);
}

/**
 * Refresh the text labels below the resolution slider so they reflect
 * the actual min/max values and the current language.
 */
function updateResolutionLabels() {
  const lang = document.documentElement.lang || 'nl';
  const fastLabel = lang === 'nl' ? '(snel)' : '(fast)';
  const preciseLabel = lang === 'nl' ? '(nauwkeurig)' : '(precise)';
  const minLabel = document.querySelector('#res-min-label');
  const maxLabel = document.querySelector('#res-max-label');
  if (minLabel) minLabel.textContent = resolutionSlider.min + ' ' + fastLabel;
  if (maxLabel) maxLabel.textContent = resolutionSlider.max + ' ' + preciseLabel;
}

// Re-apply resolution labels on language switch
window.addEventListener('langchange', updateResolutionLabels);

async function reloadResolutionFromSlider() {
  if (!state.tiff || !state.tiffImage) return;
  const targetResolution = getRequestedResolution();
  showLoading(tf('loadingReload', targetResolution));
  setLoadingDetail(state.sourceFileName + ' @ ' + targetResolution + ' px');
  resolutionSlider.disabled = true;

  // Invalidate old pixel mask — dimensions change with resolution so a
  // stale mask would point to wrong pixel coordinates, causing the overlay
  // to show data from the wrong location (e.g. top-right corner).
  state.ndviMaskData = null;
  state.ndviMaskParcels = null;

  try {
    await rebuildGeoRasterAtResolution(targetResolution);
    await displayNDVI();
    autoClassifyFromData();

    // Re-clip to selected parcels if any — the mask was just invalidated
    // and the GeoJSON geometry in state.selectedParcels is still valid.
    if (state.selectedParcels && state.selectedParcels.length > 0) {
      await clipNDVIToParcel(state.selectedParcels);
      renderClassifiedNDVI();
    }

    toast(tf('toastResolutionSet', targetResolution));
  } catch (err) {
    console.error(err);
    toast(tf('toastResolutionFail', err.message), true);
  } finally {
    resolutionSlider.disabled = false;
    hideLoading();
  }
}

let resolutionReloadTimer = null;
if (resolutionSlider) {
  resolutionSlider.addEventListener('input', function () {
    if (resolutionValue) resolutionValue.textContent = resolutionSlider.value;
    if (!state.tiff || !state.tiffImage) return;
    clearTimeout(resolutionReloadTimer);
    resolutionReloadTimer = setTimeout(reloadResolutionFromSlider, 180);
  });
  resolutionSlider.addEventListener('change', function () {
    clearTimeout(resolutionReloadTimer);
    reloadResolutionFromSlider();
  });
}

// ==========================================
// VI SELECT — populate from VEGETATION_INDICES
// ==========================================

/**
 * Returns true if all bands required by the given VI definition are
 * available in the loaded TIF (index >= 0 in state).
 * If no TIF is loaded yet, all indices are shown.
 */
function isVIAvailable(vi) {
  if (!state.georaster || state.bandMetas.length === 0) return true;
  if (vi.needsBlue    && (state.bandBlue === null || state.bandBlue < 0)) return false;
  if (vi.needsRed     && (state.bandRed === null || state.bandRed < 0)) return false;
  if (vi.needsGreen   && (state.bandGreen === null || state.bandGreen < 0)) return false;
  if (vi.needsNIR     && (state.bandNIR === null || state.bandNIR < 0)) return false;
  if (vi.needsRedEdge && (state.bandRedEdge === null || state.bandRedEdge < 0)) return false;
  return true;
}

/**
 * Populates the VI <select> with only the indices whose required bands
 * are present in the loaded TIF.  Falls back to NDVI if the previously
 * selected index is no longer available.
 */
export function populateVISelect() {
  if (!viSelect) return;
  viSelect.innerHTML = '';
  const available = VEGETATION_INDICES.filter(isVIAvailable);
  const nirIndices = available.filter(v => v.type === 'nir');
  const rgbIndices = available.filter(v => v.type === 'rgb');
  if (nirIndices.length) {
    const g1 = document.createElement('optgroup');
    g1.label = '── NIR / Multispectraal ──';
    nirIndices.forEach(vi => {
      g1.appendChild(new Option(vi.label + ' — ' + vi.formula, vi.id));
    });
    viSelect.appendChild(g1);
  }
  if (rgbIndices.length) {
    const g2 = document.createElement('optgroup');
    g2.label = '── RGB (zichtbaar licht) ──';
    rgbIndices.forEach(vi => {
      g2.appendChild(new Option(vi.label + ' — ' + vi.formula, vi.id));
    });
    viSelect.appendChild(g2);
  }
  // Fallback: als de eerder geselecteerde VI niet meer beschikbaar is, kies NDVI
  const current = state.selectedVI || 'NDVI';
  if (available.some(v => v.id === current)) {
    viSelect.value = current;
  } else {
    viSelect.value = 'NDVI';
    state.selectedVI = 'NDVI';
  }
  updateVIInfo();
  updateBandSelectorVisibility();
}

/** Updates the formula / info panel below the VI select. */
export function updateVIInfo() {
  if (!viInfo || !viFormula || !viDesc || !viDetails) return;
  const id = viSelect ? viSelect.value : 'NDVI';
  const vi = VEGETATION_INDICES.find(v => v.id === id);
  if (!vi) { viInfo.style.display = 'none'; return; }
  viFormula.textContent = vi.formula;
  viDesc.textContent = vi.desc;
  const typeLabel = vi.type === 'nir' ? 'NIR / Multispectraal' : 'RGB (zichtbaar licht)';
  viDetails.innerHTML =
    '<span>📊 ' + vi.purpose + '</span>' +
    '<span>📏 ' + vi.range + '</span>' +
    '<span>📁 ' + typeLabel + '</span>';
  viInfo.style.display = '';
  // If WDVI is selected, update the formula display in the soil-line section too
  if (id === 'WDVI') {
    const aVal = state.wdviSoilLineA != null ? state.wdviSoilLineA : 1.0;
    updateWDVIFormulaDisplay(aVal);
  }
}

// Populate once on load
populateVISelect();
updateVIInfo();

// Update info on VI change
if (viSelect) {
  viSelect.addEventListener('change', function () {
    state.selectedVI = viSelect.value;
    updateVIInfo();
    updateBandSelectorVisibility();
    updateWDVISoilLineVisibility();
    showLegendInPanel();
  });
}

// ==========================================
// WDVI SOIL LINE PARAMETER (a)
// ==========================================

const wdviSection     = document.querySelector('#wdvi-soil-line-section');
const wdviSlider      = document.querySelector('#wdvi-soil-line-slider');
const wdviValue       = document.querySelector('#wdvi-soil-line-value');
const wdviFormulaDisp = document.querySelector('#wdvi-formula-display');

/** Shows/hides the WDVI soil line section based on the selected VI. */
export function updateWDVISoilLineVisibility() {
  if (!wdviSection) return;
  const isWDVI = (state.selectedVI === 'WDVI');
  wdviSection.style.display = isWDVI ? '' : 'none';
}

/** Updates the WDVI formula display text with the current 'a' value. */
function updateWDVIFormulaDisplay(aVal) {
  if (!wdviFormulaDisp) return;
  const lang = document.documentElement.lang || 'nl';
  const template = lang === 'nl'
    ? 'Formule: NIR − {0} × R'
    : 'Formula: NIR − {0} × R';
  wdviFormulaDisp.textContent = template.replace('{0}', aVal.toFixed(2));
}

/** Reads the slider value and updates state + UI. */
function applyWDVISoilLine(value) {
  const a = parseFloat(value);
  if (isNaN(a)) return;
  state.wdviSoilLineA = a;
  if (wdviSlider) wdviSlider.value = a;
  if (wdviValue) wdviValue.textContent = a.toFixed(2);
  updateWDVIFormulaDisplay(a);
}

// Slider input (live preview)
if (wdviSlider) {
  wdviSlider.addEventListener('input', function () {
    const a = parseFloat(wdviSlider.value);
    if (wdviValue) wdviValue.textContent = a.toFixed(2);
    updateWDVIFormulaDisplay(a);
  });
  wdviSlider.addEventListener('change', function () {
    applyWDVISoilLine(wdviSlider.value);
    // Auto-recompute after a short debounce so the user sees the updated overlay
    if (state.tiff && state.tiffImage && state.selectedVI === 'WDVI') {
      computeBtn.click();
    }
  });
}

// Preset buttons
document.querySelectorAll('.wdvi-preset-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    const val = parseFloat(btn.getAttribute('data-value'));
    if (isNaN(val)) return;
    applyWDVISoilLine(val);
    if (state.tiff && state.tiffImage && state.selectedVI === 'WDVI') {
      computeBtn.click();
    }
  });
});

// Initial visibility check
updateWDVISoilLineVisibility();

/**
 * Reads the GeoTIFF at a new target resolution, rebuilding `state.georaster`.
 * Picks the best overview level automatically so we never up-scale a
 * low-resolution overview when a higher-resolution one is available.
 *
 * The resulting pseudo-GeoRaster is compatible with the canvas-based
 * overlay renderer in ndvi.js.
 * @param {number} maxDim - Maximum pixel dimension for width or height.
 * @returns {Promise<{width: number, height: number}>}
 */
export async function rebuildGeoRasterAtResolution(maxDim) {
  if (!state.tiff || !state.tiffImage) throw new Error('Geen GeoTIFF geladen.');

  const tiff = state.tiff;
  const image = state.tiffImage;
  const imageCount = await tiff.getImageCount();
  const nBands = image.getSamplesPerPixel();
  const bbox = image.getBoundingBox();
  let noDataVal = image.getGDALNoData();
  noDataVal = (noDataVal !== null && noDataVal !== undefined) ? parseFloat(noDataVal) : null;
  if (noDataVal !== null && isNaN(noDataVal)) noDataVal = null;

  // ── Overview-selectie ──
  // Overviews in TIFF zijn geordend van groot (IFD 0) naar klein (laatste IFD).
  // Voor lage-res reads (<= 512 px) pakken we direct de KLEINSTE overview (laatste IFD).
  // Dit vermijdt dat we ALLE overviews moeten laden en dat readRasters de
  // volledige 1.1 GB moet decoderen.
  let readImage = image;
  let useNativeRes = false;  // true = geen verdere readRasters-downsample nodig

  if (imageCount > 1) {
    if (maxDim <= 512) {
      // Pak direct de kleinste overview (laatste IFD) — dit is supersnel
      setLoadingDetail('Kleinste overzicht laden...');
      const smallestIdx = imageCount - 1;
      const smallest = await tiff.getImage(smallestIdx);
      const sw = smallest.getWidth(), sh = smallest.getHeight();
      console.log('[Resolutie] Kleinste overview: IFD=' + smallestIdx + ' ' + sw + 'x' + sh);
      if (sw <= maxDim * 2) {
        // Kleinste overview is al klein genoeg — gebruik native resolutie
        readImage = smallest;
        maxDim = sw;  // pas maxDim aan zodat er niet wordt opgeschaald
        useNativeRes = true;
      } else {
        // Kleinste overview is nog te groot — verderop normale search
        readImage = smallest;
      }
    }
    if (!useNativeRes) {
      // Zoek de overview die het dichtst bij maxDim zit (maar erboven)
      setLoadingDetail('Beste overzicht zoeken...');
      let bestImg = null;
      let bestW = Infinity;
      // Overviews zijn van groot → klein, dus we zoeken van voor naar achter
      // en stoppen zodra we voorbij maxDim zijn (want kleiner wordt alleen maar kleiner)
      for (let oi = 1; oi < imageCount; oi++) {
        const ov = await tiff.getImage(oi);
        const w = ov.getWidth();
        if (w >= maxDim) {
          // Deze is >= maxDim — check of deze dichterbij is dan beste
          if (!bestImg || (w - maxDim) < (bestW - maxDim)) {
            bestImg = ov;
            bestW = w;
          }
        } else {
          // w < maxDim: overviews worden steeds kleiner, dus hierna komen
          // alleen nog kleinere — stop met zoeken
          if (bestImg) break;
          // Geen enkele overview >= maxDim gevonden; gebruik de grootste die we hebben
          if (!bestImg) { bestImg = ov; bestW = w; }
          break;
        }
      }
      if (bestImg) readImage = bestImg;
    }
  }

  const rw = readImage.getWidth(), rh = readImage.getHeight();

  let tw, th, rasters;
  if (useNativeRes) {
    // Geen downsample nodig — lees de overview op z'n native resolutie
    tw = rw;
    th = rh;
    console.log('[Resolutie] Native overview: ' + tw + 'x' + th);
    setLoadingDetail('Banden laden (' + tw + '×' + th + ' px)...');
    rasters = await readImage.readRasters({ interleave: false });
  } else {
    const scale = Math.max(rw / maxDim, rh / maxDim, 1);
    tw = Math.ceil(rw / scale);
    th = Math.ceil(rh / scale);
    console.log('[Resolutie] slider=' + maxDim + ' overview=' + rw + 'x' + rh + ' output=' + tw + 'x' + th + ' scale=' + scale.toFixed(2));
    setLoadingDetail('Banden laden (' + tw + '×' + th + ' px)...');
    rasters = await readImage.readRasters({ interleave: false, width: tw, height: th, resampleMethod: 'nearest' });
  }

  const loadingText = document.querySelector('#loading-text');
  if (loadingText) loadingText.textContent = tf('loadingBands', tw, th);

  const bandMetas = state.bandMetas || [];
  const isFloat = bandMetas.length > 0 && bandMetas[0].sampleFormat === 3;
  const noDataEps = (isFloat && noDataVal !== null) ? 1e-6 : 0;
  function isNoData(v) {
    if (v === null || isNaN(v)) return true;
    if (noDataVal === null) return false;
    return noDataEps > 0 ? Math.abs(v - noDataVal) < noDataEps : v === noDataVal;
  }

  const values = [], mins = [], maxs = [];
  for (let b = 0; b < nBands; b++) {
    const flat = rasters[b];
    const rows = [];
    let bMin = Infinity, bMax = -Infinity;
    for (let r = 0; r < th; r++) {
      const row = Array.from(flat.subarray ? flat.subarray(r * tw, (r + 1) * tw) : flat.slice(r * tw, (r + 1) * tw));
      rows.push(row);
      for (let c = 0; c < tw; c++) {
        const v = row[c];
        if (!isNoData(v)) {
          if (v < bMin) bMin = v;
          if (v > bMax) bMax = v;
        }
      }
    }
    values.push(rows);
    mins.push(bMin === Infinity ? 0 : bMin);
    maxs.push(bMax === -Infinity ? 1 : bMax);
  }

  state.georaster = {
    width: tw, height: th, numberOfRasters: nBands,
    xmin: bbox[0], ymin: bbox[1], xmax: bbox[2], ymax: bbox[3],
    pixelWidth: (bbox[2] - bbox[0]) / tw,
    pixelHeight: (bbox[3] - bbox[1]) / th,
    noDataValue: noDataVal,
    projection: image.geoKeys ? (image.geoKeys.ProjectedCSTypeGeoKey || image.geoKeys.GeographicTypeGeoKey || null) : null,
    values, mins, maxs,
  };

  return { width: tw, height: th };
}

// ==========================================
// APP RESET
// ==========================================
/**
 * Resets the application to its initial clean state — clears all map
 * overlays, resets state variables, and returns the wizard to step 1.
 * Called automatically at the start of handleFileUpload() when the user
 * picks a new GeoTIFF, simulating a full page reset (F5) without
 * actually reloading the page.
 */
function resetApp() {
  // Bail out early if no TIF is loaded yet — nothing to reset.
  if (!state.tiff) return;

  // ── 1. Stop background processes ──
  stopBRPLoading();
  if (state.drawMode) stopDrawing();

  // ── 2. Clear map overlay layers ──
  ndviOverlay.clearLayers();
  brpOverlay.clearLayers();
  selectionOverlay.clearLayers();
  gridOverlay.clearLayers();
  if (map.hasLayer(gridOverlay)) map.removeLayer(gridOverlay);

  // ── 3. Reset state back to defaults ──
  state.georaster        = null;
  state.ndviLayer        = null;
  state.geotiffEPSG      = null;
  state.sourceFileName   = null;
  state.sourceWidth      = null;
  state.sourceHeight     = null;
  state.tiff             = null;
  state.tiffImage        = null;
  state.bandMetas        = [];
  state.isRGBProxy       = false;
  state.brpLayer         = null;
  state.brpGeoJSON       = null;
  state.selectedParcels  = [];
  state.selectedParcelsLayer = null;
  state.maskLayer        = null;
  state.gridLayer        = null;
  state.taskMapFC        = null;
  state.gridSize         = 10;
  state.gridAngle        = 0;
  state.parcelHistoryCache = {};
  state.numAlphaBands    = 0;
  state.bandRed          = null;
  state.bandGreen        = null;
  state.bandBlue         = null;
  state.bandNIR          = null;
  state.bandRedEdge      = null;
  state.selectedVI       = 'NDVI';
  state.classes          = defaultClasses();
  state.unit             = 'kg/ha';
  state.currentStep      = 1;
  state.isPreCalc        = false;
  state.brpLoading       = false;
  state.ndviHistogramData  = null;
  state.ndviGrid         = null;
  state.ndviScaleMin     = null;
  state.ndviScaleMax     = null;
  state.brpLayerMap      = {};
  state.drawMode         = false;
  state.drawLayer        = null;
  state.drawTempPoints   = [];
  state.drawStartPoint   = null;
  state.manualFields     = [];
  state.selectedCellId   = null;
  state.selectedCellLayer = null;
  state.cellOverrides    = {};
  state.classificationMethod = 'quantile';
  state.ndviMaskData     = null;
  state.ndviMaskParcels  = null;

  if (state.blobUrl) {
    URL.revokeObjectURL(state.blobUrl);
    state.blobUrl = null;
  }

  // ── 4. Clear file info UI ──
  document.querySelector('#file-info').classList.add('hidden');
  document.querySelector('#info-filename').textContent = '';
  document.querySelector('#info-dims').textContent = '';
  document.querySelector('#info-bands').textContent = '';
  document.querySelector('#info-mode').textContent = '';
  document.querySelector('#info-ndvi-range').textContent = '';
  document.querySelector('#ndvi-stats-row').classList.add('hidden');

  // ── 5. Clear band & VI selectors ──
  document.querySelector('#band-info-row').classList.add('hidden');
  ['#red-band', '#green-band', '#blue-band', '#nir-band', '#rededge-band'].forEach(function (sel) {
    const el = document.querySelector(sel);
    if (el) el.innerHTML = '';
  });
  if (viSelect) viSelect.innerHTML = '';
  document.querySelector('#band-desc').textContent = '';

  // ── 6. Hide histogram ──
  const histWrap = document.querySelector('#ndvi-histogram-wrap');
  if (histWrap) histWrap.style.display = 'none';

  // ── 7. Reset wizard to step 1 and hide legend/NDVI sections ──
  activateStep(1);
  const ndviSection = document.querySelector('.ulc-ndvi-section');
  if (ndviSection) ndviSection.style.display = 'none';
  clearLegendCrop();
  updateLayerVisibility();

  // ── 8. Reset legend labels to defaults ──
  const legendLabels = document.querySelector('#legend-labels');
  if (legendLabels) legendLabels.innerHTML = '<span>-0.20</span><span>0.40</span><span>1.00</span>';

  // ── 9. Reset resolution slider ──
  const resSlider = document.querySelector('#resolution-slider');
  if (resSlider) {
    resSlider.min = 64;
    resSlider.max = 2048;
    resSlider.step = 64;
    resSlider.value = 1024;
  }
  const resVal = document.querySelector('#resolution-value');
  if (resVal) resVal.textContent = '1024 px';
}

// ==========================================
// FILE UPLOAD
// ==========================================
geotiffInput.addEventListener('change', function (e) {
  const file = e.target.files && e.target.files[0];
  if (file) handleFileUpload(file);
});

fileDrop.addEventListener('dragover', function (e) { e.preventDefault(); fileDrop.classList.add('drag-over'); });
fileDrop.addEventListener('dragleave', function () { fileDrop.classList.remove('drag-over'); });
fileDrop.addEventListener('drop', function (e) {
  e.preventDefault();
  fileDrop.classList.remove('drag-over');
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleFileUpload(file);
});

async function handleFileUpload(file) {
  // Reset the app to a clean state if a TIF was already loaded — this
  // clears all map overlays, resets wizard steps, and aborts background
  // processes, effectively simulating a page F5 before loading the new file.
  resetApp();
  showLoading(t('loadingGeoTIFF'));
  setLoadingDetail(file.name + ' (' + (file.size / 1024 / 1024).toFixed(1) + ' MB)');
  try {
    const GTIFF = window.GeoTIFF;
    if (!GTIFF) throw new Error('geotiff.js niet geladen — herlaad de pagina.');

    const blobUrl = URL.createObjectURL(file);
    state.blobUrl = blobUrl;

    setLoadingDetail('TIF-structuur parseren...');
    const tiff = await GTIFF.fromUrl(blobUrl);
    setLoadingDetail('Overzichten indexeren...');
    const imageCount = await tiff.getImageCount();
    const image = await tiff.getImage(0);

    const nBands = image.getSamplesPerPixel();
    const bbox   = image.getBoundingBox();
    const fullW  = image.getWidth();
    const fullH  = image.getHeight();

    // Store original dimensions for resolution slider
    state.sourceWidth = fullW;
    state.sourceHeight = fullH;

    // Dynamically set slider range based on the actual source dimensions
    updateResolutionSliderForData(fullW, fullH);

    // Detect alpha channels
    const fd = image.fileDirectory || {};
    let extraSamplesRaw = fd.ExtraSamples;
    let extraSamples = [];
    if (Array.isArray(extraSamplesRaw)) {
      extraSamples = extraSamplesRaw;
    } else if (extraSamplesRaw != null && typeof extraSamplesRaw === 'object') {
      const esKeys = Object.keys(extraSamplesRaw).sort((a, b) => Number(a) - Number(b));
      extraSamples = esKeys.map(k => extraSamplesRaw[k]);
    } else if (extraSamplesRaw != null) {
      extraSamples = [extraSamplesRaw];
    }
    const nAlpha = extraSamples.filter(s => s === 1 || s === 2).length;
    const nDataBands = Math.max(1, nBands - nAlpha);
    let noDataVal = image.getGDALNoData();
    noDataVal = (noDataVal !== null && noDataVal !== undefined) ? parseFloat(noDataVal) : null;
    if (noDataVal !== null && isNaN(noDataVal)) noDataVal = null;

    // Read GDAL_METADATA XML
    const rawGDALMeta = fd.GDAL_METADATA || '';
    const xmlItemsByBand = {};
    if (rawGDALMeta) {
      const reXml = /<Item\b([^>]*)>([\s\S]*?)<\/Item>/gi;
      let xm;
      while ((xm = reXml.exec(rawGDALMeta)) !== null) {
        const xAttrs = xm[1], xVal = xm[2].trim();
        const xName = xAttrs.match(/name\s*=\s*["']([^"']+)["']/i);
        const xSamp = xAttrs.match(/sample\s*=\s*["'](\d+)["']/i);
        if (xName) {
          const xIdx = xSamp ? parseInt(xSamp[1]) : -1;
          if (!xmlItemsByBand[xIdx]) xmlItemsByBand[xIdx] = {};
          xmlItemsByBand[xIdx][xName[1].toLowerCase()] = xVal;
        }
      }
    }
    console.log('[GDAL_METADATA raw]', rawGDALMeta || '(geen)');
    console.log('[GDAL XML parsed]', JSON.stringify(xmlItemsByBand));

    const bandMetas = [];
    for (let bi = 0; bi < nBands; bi++) {
      setLoadingDetail('Band ' + (bi + 1) + ' van ' + nBands + ' verwerken...');
      const bmeta = image.getGDALMetadata(bi) || {};
      const bmetaLC = {};
      for (const k in bmeta) if (Object.prototype.hasOwnProperty.call(bmeta, k)) bmetaLC[k.toLowerCase()] = bmeta[k];
      const xmlBand = xmlItemsByBand[bi] || {};
      for (const xk in xmlBand) if (Object.prototype.hasOwnProperty.call(xmlBand, xk) && !bmetaLC[xk]) bmetaLC[xk] = xmlBand[xk];
      let wl = parseFloat(
        bmetaLC.wavelength || bmetaLC.central_wavelength ||
        bmetaLC['center wavelength'] || bmetaLC.cwl || '0'
      ) || 0;
      let bname = (
        bmetaLC.description || bmetaLC['band name'] || bmetaLC.band_name ||
        bmetaLC.bandname || bmetaLC.name || ''
      ).trim();
      if (wl === 0 && bname) {
        const wlM = bname.match(/(\d{3,4})\s*nm/i);
        if (wlM) wl = parseFloat(wlM[1]) || 0;
      }
      bandMetas.push({ wavelength: wl, name: bname, sampleFormat: image.getSampleFormat(bi), bitsPerSample: image.getBitsPerSample(bi) });
    }
    state.bandMetas = bandMetas;
    console.log('[Band metadata]', bandMetas.map((m, i) => 'B' + (i + 1) + ' "' + m.name + '" wl=' + m.wavelength).join(' | '));

    function pickBand(wlLow, wlHigh, nameRe, fallbacksInOrder) {
      for (let i = 0; i < nDataBands; i++) if (bandMetas[i].wavelength >= wlLow && bandMetas[i].wavelength <= wlHigh) return i;
      for (let i = 0; i < nDataBands; i++) if (bandMetas[i].wavelength >= wlLow - 30 && bandMetas[i].wavelength <= wlHigh + 30) return i;
      for (let i = 0; i < nDataBands; i++) if (bandMetas[i].name && nameRe.test(bandMetas[i].name)) return i;
      return fallbacksInOrder[0] !== undefined ? fallbacksInOrder[0] : 0;
    }

    const photoInterp = fd.PhotometricInterpretation || 0;
    const hasSpectralMeta = bandMetas.some(m => m.wavelength > 0 || m.name);
    const isRGBProxy = (photoInterp === 2) && (nDataBands >= 3) && !hasSpectralMeta;
    state.isRGBProxy = isRGBProxy;

    const geoKeys = image.geoKeys || {};
    const epsgCode = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey || null;
    const epsg = ensureEPSG(epsgCode);

    state.tiff = tiff;
    state.tiffImage = image;
    state.geotiffEPSG = epsg;
    state.sourceFileName = file.name;
    state.numAlphaBands = nAlpha;

    const rasterInfo = await rebuildGeoRasterAtResolution(getRequestedResolution());
    const { width: tw, height: th } = rasterInfo;

    document.querySelector('#info-filename').textContent = file.name;
    // Toon zowel volledige als geladen dimensies zodat duidelijk is dat er
    // NIET op volle resolutie wordt gewerkt
    const loadedNote = tw < fullW ? ' (gelaagd: ' + tw + '\xd7' + th + ' px)' : '';
    document.querySelector('#info-dims').textContent = fullW + ' \xd7 ' + fullH + ' px' + loadedNote;
    document.querySelector('#info-bands').textContent = nDataBands + (nAlpha > 0 ? ' (+ ' + nAlpha + ' alpha)' : '');
    fileInfo.classList.remove('hidden');

    if (nDataBands === 1) {
      state.isPreCalc = true;
      state.isRGBProxy = false;
      document.querySelector('#info-mode').textContent = t('modePrecalcNDVI');
      setLoadingDetail(t('loadingRender'));
      await displayNDVI();
      autoClassifyFromData();
      hideLoading();
      toast(t('toastNDVIDetected'));
      zoomToGeoTIFF();
      activateStep(2);
      startBRPLoading();
    } else if (isRGBProxy) {
      state.isPreCalc = false;
      state.bandRed = 0;
      state.bandNIR = 1;
      const ovNote2 = tw < fullW ? tf('loadedAs', tw, th) : '';
      document.querySelector('#info-mode').textContent = t('modeRGBMap') + ovNote2;
      document.querySelector('#band-info-row').classList.add('hidden');
      populateBandSelectors(nDataBands);
      populateVISelect();
      document.querySelector('#band-desc').textContent = t('bandDescRGB');
      setLoadingDetail(t('loadingRender'));
      await displayNDVI();
      autoClassifyFromData();
      hideLoading();
      toast(t('toastRGBDetected'));
      zoomToGeoTIFF();
      activateStep(2);
      startBRPLoading();
    } else {
      state.isPreCalc = false;
      // WebODM sorteert banden op golflengte (klein → groot), dus de meest
      // voorkomende volgordes zijn:
      //   5-band: B(450), G(560), R(650), RE(730), NIR(840) → R=2, G=1, B=0, NIR=4, RE=3
      //   4-band (M3M): G(560), R(650), RE(730), NIR(840)  → R=1, G=0, B=-1, NIR=3, RE=2
      //   Anders: laatste band / n-1 als NIR-fallback (vaak hoogste golflengte).
      state.bandRed     = pickBand(620, 700, /\bred\b(?!.?edge)/i, [nDataBands >= 5 ? 2 : (nDataBands === 4 ? 1 : 0)]);
      state.bandGreen   = pickBand(520, 580, /\bgreen\b/i,          [nDataBands >= 5 ? 1 : (nDataBands === 4 ? 0 : 1)]);
      state.bandBlue    = pickBand(440, 510, /\bblue\b|coastal/i,   [-1]);
      state.bandNIR     = pickBand(780, 960, /\bnir\b|near.?ir|near.?infra/i, [nDataBands >= 5 ? 4 : (nDataBands >= 4 ? 3 : nDataBands - 1)]);
      state.bandRedEdge = pickBand(700, 780, /\bred.?edge\b|\bre\b/i, [nDataBands >= 5 ? 3 : (nDataBands === 4 ? 2 : -1)]);

      // Check of pickBand via metadata (golflengte/naam) heeft gewerkt of fallback gebruikte.
      // Alleen als minimaal Red EN NIR een metadata-match hebben, gaan we ervan uit dat
      // de toewijzing klopt. Anders laten we de auto-heuristic de boel corrigeren.
      function _matchedByMeta(wlLo, wlHi, nameRe) {
        return bandMetas.slice(0, nDataBands).some(m =>
          (m.wavelength > 0 && m.wavelength >= wlLo && m.wavelength <= wlHi) ||
          (m.name && nameRe.test(m.name))
        );
      }
      const redMatched   = _matchedByMeta(620, 700, /\bred\b(?!.?edge)/i);
      const nirMatched   = _matchedByMeta(780, 960, /\bnir\b|near.?ir|near.?infra/i);
      const needsHeuristic = !redMatched || !nirMatched;
      if (needsHeuristic && nDataBands >= 2) {
        const gr = state.georaster;
        const values = gr.values;
        const bandMeans = [];
        for (let i = 0; i < nDataBands; i++) {
          let s = 0, cnt = 0;
          const bvals = values[i];
          for (let rr = 0; rr < th; rr += 4)
            for (let cc = 0; cc < tw; cc += 4) {
              const vv = bvals[rr][cc];
              if (!isNaN(vv) && vv !== noDataVal && vv !== null) { s += vv; cnt++; }
            }
          bandMeans.push(cnt > 0 ? s / cnt : 0);
        }
        // NIR = hoogste gemiddelde (vegetatie reflecteert NIR het sterkst)
        const sorted = bandMeans.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
        state.bandNIR = sorted[0].i;
        // Red = laagste gemiddelde (niet-NIR) — Rood is donkerste visuele band
        let redIdx = -1;
        let redMin = Infinity;
        for (let i = 0; i < nDataBands; i++) {
          if (i === state.bandNIR) continue;
          if (bandMeans[i] > 0 && bandMeans[i] < redMin) { redMin = bandMeans[i]; redIdx = i; }
        }
        state.bandRed = redIdx >= 0 ? redIdx : sorted[sorted.length - 1].i;
        console.log('[Auto heuristic] band means:', bandMeans.map((v, i) => 'B' + (i + 1) + ':' + v.toFixed(4)).join(' '));
        console.log('[Auto heuristic] Red=B' + (state.bandRed + 1) + ' NIR=B' + (state.bandNIR + 1) + ' (redMatched=' + redMatched + ' nirMatched=' + nirMatched + ')');
      }
      if (state.bandRed === state.bandNIR)
        state.bandNIR = state.bandRed === nDataBands - 1 ? nDataBands - 2 : nDataBands - 1;

      const gr = state.georaster;
      console.log('[Banden]', bandMetas.map((m, i) =>
        'B' + (i + 1) + ':' + (m.name || '?') + (m.wavelength ? '@' + m.wavelength + 'nm' : '') +
        ' ' + m.bitsPerSample + 'bit sf=' + m.sampleFormat +
        ' min=' + (gr.mins[i] != null ? gr.mins[i].toFixed(4) : '?') +
        ' max=' + (gr.maxs[i] != null ? gr.maxs[i].toFixed(4) : '?')).join(' | '));
      console.log('[Auto-detect] Red=B' + (state.bandRed + 1) + ' NIR=B' + (state.bandNIR + 1));

      const tbl = document.querySelector('#band-info-table');
      if (tbl) {
        tbl.innerHTML = '<tr style="color:#aaa"><th>B</th><th>Naam</th><th>nm</th><th>Min</th><th>Max</th></tr>' +
          bandMetas.slice(0, nDataBands).map((m, i) => {
            const isR = i === state.bandRed, isG = i === state.bandGreen, isB = i === state.bandBlue, isN = i === state.bandNIR, isRE = i === state.bandRedEdge;
            const flags = [];
            if (isR) flags.push('🔴R'); if (isG) flags.push('🟢G'); if (isB) flags.push('🔵B'); if (isN) flags.push('🟣N'); if (isRE) flags.push('🟠RE');
            const flag = flags.length ? ' ' + flags.join(' ') : '';
            const isHighlight = isR || isN;
            return '<tr style="' + (isHighlight ? 'font-weight:bold' : '') + '">' +
              '<td>B' + (i + 1) + flag + '</td>' +
              '<td>' + escapeHtml(m.name || '-') + '</td>' +
              '<td>' + escapeHtml(m.wavelength || '-') + '</td>' +
              '<td>' + (gr.mins[i] != null ? gr.mins[i].toFixed(3) : '-') + '</td>' +
              '<td>' + (gr.maxs[i] != null ? gr.maxs[i].toFixed(3) : '-') + '</td>' +
              '</tr>';
          }).join('');
        document.querySelector('#band-info-row').classList.remove('hidden');
      }

      const ovNote = tw < fullW ? tf('loadedAs', tw, th) : '';
      document.querySelector('#info-mode').textContent = tf('modeBands', nDataBands) + ovNote;
      populateBandSelectors(nDataBands);
      populateVISelect();
      document.querySelector('#band-desc').textContent = t('bandDescMulti');
      displayRGB();
      zoomToGeoTIFF();
      // BRP alvast starten zodat percelen zichtbaar zijn op stap 2
      startBRPLoading();
      hideLoading();
      toast(t('toastGeoTIFFLoaded'));
      activateStep(2);
    }
  } catch (err) {
    hideLoading();
    console.error(err);
    toast(tf('toastLoadError', err.message), true);
  }
}

// ==========================================
// BAND SELECTORS
// ==========================================
export function populateBandSelectors(n) {
  redBandSel.innerHTML = '';
  greenBandSel.innerHTML = '';
  blueBandSel.innerHTML = '';
  nirBandSel.innerHTML = '';
  rededgeBandSel.innerHTML = '';
  const metas = state.bandMetas || [];
  // WebODM sorteert banden op golflengte (klein → groot)
  // 5-band: B(475), G(560), R(668), RE(717), NIR(840)
  // 4-band (DJI P4M/M3M): G(560), R(650), RE(730), NIR(840) — géén blauw
  // 3-band RGB: R, G, B (niet wavelength-sorted, gewoon RGB)
  const odmNames5 = ['Blue (B)', 'Green (G)', 'Red (R)', 'RedEdge (RE)', 'NIR'];
  const odmNames4 = ['Green (G)', 'Red (R)', 'RedEdge (RE)', 'NIR'];
  const odmNames3 = ['Red (R)', 'Green (G)', 'Blue (B)'];
  const rgbNames3 = ['Red (R)', 'NIR (G-kanaal)', 'Blue (B)'];
  const rgbNames4 = ['Red (R)', 'NIR (G-kanaal)', 'Blue (B)', 'Alpha'];
  for (let i = 0; i < n; i++) {
    const m = metas[i] || {};
    const gr = state.georaster;
    let lbl;
    if (m.name && m.wavelength) {
      lbl = 'B' + (i + 1) + ': ' + m.name + ' (' + m.wavelength + ' nm)';
    } else if (m.name) {
      lbl = 'B' + (i + 1) + ': ' + m.name;
    } else if (state.isRGBProxy) {
      const rgbName = n >= 4 ? (rgbNames4[i] || 'Band ' + (i + 1))
        : n === 3 ? (rgbNames3[i] || 'Band ' + (i + 1))
        : 'Band ' + (i + 1);
      lbl = 'B' + (i + 1) + ': ' + rgbName + (gr ? '  [' + gr.mins[i].toFixed(2) + '\u2013' + gr.maxs[i].toFixed(2) + ']' : '');
    } else {
      const guessName = n === 5 ? odmNames5[i] : n === 4 ? odmNames4[i] : n === 3 ? odmNames3[i] : 'Band ' + (i + 1);
      lbl = 'B' + (i + 1) + ': ' + guessName + (gr ? '  [' + gr.mins[i].toFixed(2) + '\u2013' + gr.maxs[i].toFixed(2) + ']' : '');
    }
    redBandSel.add(new Option(lbl, i));
    greenBandSel.add(new Option(lbl, i));
    blueBandSel.add(new Option(lbl, i));
    nirBandSel.add(new Option(lbl, i));
    rededgeBandSel.add(new Option(lbl, i));
  }
  if (state.bandRed !== null) redBandSel.value = state.bandRed;
  if (state.bandGreen !== null) greenBandSel.value = state.bandGreen;
  if (state.bandBlue !== null) blueBandSel.value = state.bandBlue;
  if (state.bandNIR !== null) nirBandSel.value = state.bandNIR;
  if (state.bandRedEdge !== null && state.bandRedEdge >= 0) rededgeBandSel.value = state.bandRedEdge;
  if (viSelect) viSelect.value = state.selectedVI || 'NDVI';
  updateBandSelectorVisibility();
}

export function updateBandSelectorVisibility() {
  const vi = viSelect ? viSelect.value : 'NDVI';
  const def = VEGETATION_INDICES.find(v => v.id === vi);
  const needR  = def ? def.needsRed : true;
  const needG  = def ? def.needsGreen : false;
  const needB  = def ? def.needsBlue : false;
  const needN  = def ? def.needsNIR : true;
  const needRE = def ? def.needsRedEdge : false;
  redBandSel.closest('.form-row').style.display     = needR  ? '' : 'none';
  greenBandSel.closest('.form-row').style.display   = needG  ? '' : 'none';
  blueBandSel.closest('.form-row').style.display    = needB  ? '' : 'none';
  nirBandSel.closest('.form-row').style.display     = needN  ? '' : 'none';
  rededgeBandSel.closest('.form-row').style.display = needRE ? '' : 'none';
}
if (viSelect) viSelect.addEventListener('change', updateBandSelectorVisibility);

computeBtn.addEventListener('click', function () {
  state.bandRed      = parseInt(redBandSel.value);
  state.bandGreen    = parseInt(greenBandSel.value);
  state.bandBlue     = blueBandSel && blueBandSel.value ? parseInt(blueBandSel.value) : -1;
  state.bandNIR      = parseInt(nirBandSel.value);
  state.bandRedEdge  = rededgeBandSel && rededgeBandSel.value ? parseInt(rededgeBandSel.value) : -1;
  state.selectedVI   = viSelect ? viSelect.value : 'NDVI';
  state.isPreCalc    = false;
  state.isRGBProxy   = false;
  const vi = state.selectedVI;
  const def = VEGETATION_INDICES.find(v => v.id === vi);
  // Check for duplicate bands
  const usedBands = [];
  if (def && def.needsRed) usedBands.push(state.bandRed);
  if (def && def.needsGreen) usedBands.push(state.bandGreen);
  if (def && def.needsBlue) usedBands.push(state.bandBlue);
  if (def && def.needsNIR) usedBands.push(state.bandNIR);
  if (def && def.needsRedEdge) usedBands.push(state.bandRedEdge);
  const unique = new Set(usedBands);
  if (unique.size !== usedBands.length) { toast(t('toastSameBands'), true); return; }
  // Check of alle benodigde banden een geldig index hebben (>=0)
  const missingBand = usedBands.some(idx => idx < 0);
  if (missingBand) { toast(tf('toastMissingBand', vi), true); return; }  // Her-populeer de VI lijst (want bandtoewijzing kan veranderd zijn)
  populateVISelect();  showLoading(tf('loadingVI', vi));
  setLoadingDetail(state.sourceFileName + ' \u2014 ' + vi + ' @ ' + getRequestedResolution() + ' px');
  setTimeout(async function () {
    await displayNDVI();
    autoClassifyFromData();
    zoomToGeoTIFF();
    // Als er al percelen geselecteerd zijn, knip de VI direct naar de selectie
    if (state.selectedParcels && state.selectedParcels.length > 0) {
      await clipNDVIToParcel(state.selectedParcels);
      if (state.classificationMethod !== 'manual') {
        autoClassifyFromData();
      }
    }
    hideLoading();
    toast(tf('toastVIComputed', state.selectedVI));
    activateStep(4);
    startBRPLoading();
  }, 50);
});


// EOF
