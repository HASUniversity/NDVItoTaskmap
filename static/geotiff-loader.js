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

import { state } from './state.js';
import { ensureEPSG, showLoading, hideLoading, toast } from './utils.js';
import { escapeHtml } from './utils.js';
import { displayNDVI, zoomToGeoTIFF } from './ndvi.js';
import { startBRPLoading } from './brp.js';
import { activateStep } from './steps.js';

const { t, tf } = window;

// ==========================================
// DOM REFERENCES
// ==========================================
const geotiffInput    = document.querySelector('#geotiff-input');
const fileDrop        = document.querySelector('#file-drop');
const fileInfo        = document.querySelector('#file-info');
const redBandSel      = document.querySelector('#red-band');
const greenBandSel    = document.querySelector('#green-band');
const nirBandSel      = document.querySelector('#nir-band');
const rededgeBandSel  = document.querySelector('#rededge-band');
export const viSelect = document.querySelector('#vi-select');
const computeBtn      = document.querySelector('#compute-ndvi-btn');
const stretchCheck    = document.querySelector('#stretch-ndvi');
const resolutionSlider = document.querySelector('#resolution-slider');
const resolutionValue  = document.querySelector('#resolution-value');

export { stretchCheck };

/**
 * Returns the pixel-dimension limit selected by the resolution slider.
 * The raster is scaled so that its largest dimension equals this value.
 * @returns {number} Pixel limit (512–8192).
 */
export function getRequestedResolution() {
  const requested = resolutionSlider ? parseInt(resolutionSlider.value, 10) : 1024;
  return isNaN(requested) ? 1024 : requested;
}

async function reloadResolutionFromSlider() {
  if (!state.tiff || !state.tiffImage) return;
  const targetResolution = getRequestedResolution();
  showLoading(tf('loadingReload', targetResolution));
  resolutionSlider.disabled = true;
  try {
    await rebuildGeoRasterAtResolution(targetResolution);
    displayNDVI();
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

  let readImage = image;
  if (imageCount > 1) {
    const candidates = [];
    for (let oi = 1; oi < imageCount; oi++) {
      const ov = await tiff.getImage(oi);
      candidates.push({ idx: oi, w: ov.getWidth(), img: ov });
    }
    candidates.sort((a, b) => a.w - b.w);
    for (let ci = 0; ci < candidates.length; ci++) {
      if (candidates[ci].w >= maxDim) { readImage = candidates[ci].img; break; }
    }
  }

  const rw = readImage.getWidth(), rh = readImage.getHeight();
  const scale = Math.max(rw / maxDim, rh / maxDim, 1);
  const tw = Math.ceil(rw / scale), th = Math.ceil(rh / scale);
  console.log('[Resolutie] slider=' + maxDim + ' overview=' + rw + 'x' + rh + ' output=' + tw + 'x' + th + ' scale=' + scale.toFixed(2));

  const loadingText = document.querySelector('#loading-text');
  if (loadingText) loadingText.textContent = tf('loadingBands', tw, th);

  const rasters = await readImage.readRasters({ interleave: false, width: tw, height: th, resampleMethod: 'bilinear' });

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
  if (state.blobUrl) { URL.revokeObjectURL(state.blobUrl); state.blobUrl = null; }
  showLoading(t('loadingGeoTIFF'));
  try {
    const GTIFF = window.GeoTIFF;
    if (!GTIFF) throw new Error('geotiff.js niet geladen — herlaad de pagina.');

    const blobUrl = URL.createObjectURL(file);
    state.blobUrl = blobUrl;

    const tiff = await GTIFF.fromUrl(blobUrl);
    const imageCount = await tiff.getImageCount();
    const image = await tiff.getImage(0);

    const nBands = image.getSamplesPerPixel();
    const bbox   = image.getBoundingBox();
    const fullW  = image.getWidth();
    const fullH  = image.getHeight();

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

    const rasterInfo = await rebuildGeoRasterAtResolution(getRequestedResolution());
    const { width: tw, height: th } = rasterInfo;

    document.querySelector('#info-filename').textContent = file.name;
    document.querySelector('#info-dims').textContent = fullW + ' \xd7 ' + fullH + ' px';
    document.querySelector('#info-bands').textContent = nDataBands + (nAlpha > 0 ? ' (+ ' + nAlpha + ' alpha)' : '');
    fileInfo.classList.remove('hidden');

    if (nDataBands === 1) {
      state.isPreCalc = true;
      state.isRGBProxy = false;
      document.querySelector('#info-mode').textContent = t('modePrecalcNDVI');
      hideLoading();
      toast(t('toastNDVIDetected'));
      displayNDVI();
      zoomToGeoTIFF();
      activateStep(3);
      startBRPLoading();
    } else if (isRGBProxy) {
      state.isPreCalc = false;
      state.bandRed = 0;
      state.bandNIR = 1;
      const ovNote2 = tw < fullW ? tf('loadedAs', tw, th) : '';
      document.querySelector('#info-mode').textContent = t('modeRGBMap') + ovNote2;
      document.querySelector('#band-info-row').classList.add('hidden');
      populateBandSelectors(nDataBands);
      document.querySelector('#band-desc').textContent = t('bandDescRGB');
      hideLoading();
      toast(t('toastRGBDetected'));
      displayNDVI();
      zoomToGeoTIFF();
      activateStep(3);
      startBRPLoading();
    } else {
      state.isPreCalc = false;
      state.bandRed     = pickBand(620, 700, /\bred\b(?!.?edge)/i, [nDataBands >= 5 ? 3 : (nDataBands >= 4 ? 2 : 0)]);
      state.bandGreen   = pickBand(520, 580, /\bgreen\b/i,          [nDataBands >= 5 ? 1 : (nDataBands >= 3 ? 1 : 0)]);
      state.bandNIR     = pickBand(780, 960, /\bnir\b|near.?ir|near.?infra/i, [nDataBands >= 5 ? 2 : (nDataBands >= 4 ? 3 : nDataBands - 1)]);
      state.bandRedEdge = pickBand(700, 780, /\bred.?edge\b|\bre\b/i, [nDataBands >= 5 ? 4 : -1]);

      const hasWlOrName = bandMetas.some(m => m.wavelength > 0 || m.name);
      if (!hasWlOrName && nDataBands >= 2) {
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
        const sorted = bandMeans.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
        state.bandNIR = sorted[0].i;
        const nirMean = sorted[0].v;
        let best = -1, bestDiff = Infinity;
        for (let i = 0; i < nDataBands; i++) {
          if (i === state.bandNIR) continue;
          const diff = Math.abs(bandMeans[i] - nirMean * 0.65);
          if (diff < bestDiff) { bestDiff = diff; best = i; }
        }
        state.bandRed = best >= 0 ? best : sorted[1].i;
        console.log('[Auto heuristic] band means:', bandMeans.map((v, i) => 'B' + (i + 1) + ':' + v.toFixed(4)).join(' '));
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
            const isR = i === state.bandRed, isN = i === state.bandNIR;
            const flag = isR ? ' 🔴R' : (isN ? ' 🟢N' : '');
            return '<tr style="' + (isR || isN ? 'font-weight:bold' : '') + '">' +
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
      document.querySelector('#band-desc').textContent = t('bandDescMulti');
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
  nirBandSel.innerHTML = '';
  rededgeBandSel.innerHTML = '';
  const metas = state.bandMetas || [];
  const odmNames5 = ['Blue (B)', 'Green (G)', 'NIR', 'Red (R)', 'RedEdge (RE)'];
  const odmNames4 = ['Blue (B)', 'Green (G)', 'Red (R)', 'NIR'];
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
    nirBandSel.add(new Option(lbl, i));
    rededgeBandSel.add(new Option(lbl, i));
  }
  if (state.bandRed !== null) redBandSel.value = state.bandRed;
  if (state.bandGreen !== null) greenBandSel.value = state.bandGreen;
  if (state.bandNIR !== null) nirBandSel.value = state.bandNIR;
  if (state.bandRedEdge !== null && state.bandRedEdge >= 0) rededgeBandSel.value = state.bandRedEdge;
  if (viSelect) viSelect.value = state.selectedVI || 'NDVI';
  updateBandSelectorVisibility();
}

export function updateBandSelectorVisibility() {
  const vi = viSelect ? viSelect.value : 'NDVI';
  redBandSel.closest('.form-row').style.display     = (vi === 'NDVI' || vi === 'SAVI' || vi === 'OSAVI') ? '' : 'none';
  greenBandSel.closest('.form-row').style.display   = (vi === 'GNDVI') ? '' : 'none';
  rededgeBandSel.closest('.form-row').style.display = (vi === 'NDRE') ? '' : 'none';
}
if (viSelect) viSelect.addEventListener('change', updateBandSelectorVisibility);

computeBtn.addEventListener('click', function () {
  state.bandRed      = parseInt(redBandSel.value);
  state.bandGreen    = parseInt(greenBandSel.value);
  state.bandNIR      = parseInt(nirBandSel.value);
  state.bandRedEdge  = parseInt(rededgeBandSel.value);
  state.selectedVI   = viSelect ? viSelect.value : 'NDVI';
  state.isPreCalc    = false;
  state.isRGBProxy   = false;
  const vi = state.selectedVI;
  const bandA = state.bandNIR;
  const bandB = vi === 'GNDVI' ? state.bandGreen : vi === 'NDRE' ? state.bandRedEdge : state.bandRed;
  if (bandA === bandB) { toast(t('toastSameBands'), true); return; }
  showLoading(tf('loadingVI', vi));
  setTimeout(function () {
    displayNDVI();
    zoomToGeoTIFF();
    hideLoading();
    toast(tf('toastVIComputed', state.selectedVI));
    activateStep(3);
    startBRPLoading();
  }, 50);
});
