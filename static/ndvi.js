/* ===================================================
   ndvi.js — NDVI rendering, histogram, colour ramps

   Handles the full pipeline from raw band values to
   colourised map overlays:
     1. Colour ramp functions (ndviToColor / ndviToRGB)
     2. Canvas-based overlay rendering (displayNDVI)
     3. Parcel-masked clipping (clipNDVIToParcel)
     4. Histogram drawing on <canvas> (drawNDVIHistogram)
     5. Equal-area auto-classification (autoClassifyFromData)
   =================================================== */

import { state } from './state.js';
import { toast } from './utils.js';
import { map, ndviOverlay, legend, showLegendInPanel, setLegendLabels } from './map.js';

const { t } = window;

/**
 * Maps a VI value to a CSS rgba() colour using a 9-stop diverging
 * green–yellow–red ramp (based on ColorBrewer RdYlGn, 9 classes).
 * Used for the legend swatches and class colour previews.
 * @param {number|null} ndvi - Index value in the range [-0.2, 1.0].
 * @returns {string|null} CSS colour string, or null for invalid input.
 */
export function ndviToColor(ndvi) {
  if (ndvi === null || ndvi === undefined || isNaN(ndvi)) return null;
  ndvi = Math.max(-0.2, Math.min(1, ndvi));
  const stops = [
    { v: -0.2, r: 165, g: 0,   b: 38  },
    { v:  0.0, r: 215, g: 48,  b: 39  },
    { v:  0.2, r: 253, g: 174, b: 97  },
    { v:  0.35,r: 254, g: 224, b: 139 },
    { v:  0.5, r: 217, g: 239, b: 139 },
    { v:  0.6, r: 166, g: 217, b: 106 },
    { v:  0.7, r: 102, g: 189, b: 99  },
    { v:  0.85,r: 26,  g: 150, b: 65  },
    { v:  1.0, r: 0,   g: 104, b: 55  },
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (ndvi >= stops[i].v && ndvi <= stops[i + 1].v) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const t2 = hi.v === lo.v ? 0 : (ndvi - lo.v) / (hi.v - lo.v);
  const r = Math.round(lo.r + t2 * (hi.r - lo.r));
  const g = Math.round(lo.g + t2 * (hi.g - lo.g));
  const b = Math.round(lo.b + t2 * (hi.b - lo.b));
  return 'rgba(' + r + ',' + g + ',' + b + ',0.85)';
}

/**
 * Maps a VI value to an {r, g, b} object using a linear scale between
 * `scaleMin` and `scaleMax`.  Used for painting the overlay canvas pixel
 * by pixel for maximum performance (avoids per-pixel string allocation).
 * @param {number}  ndvi     - Index value.
 * @param {number}  scaleMin - Lower end of the display scale.
 * @param {number}  scaleMax - Upper end of the display scale.
 * @returns {{ r: number, g: number, b: number }|null}
 */
export function ndviToRGB(ndvi, scaleMin, scaleMax) {
  if (ndvi === null || ndvi === undefined || isNaN(ndvi)) return null;
  scaleMin = (scaleMin !== undefined) ? scaleMin : -0.2;
  scaleMax = (scaleMax !== undefined) ? scaleMax : 1.0;
  let t2 = (ndvi - scaleMin) / (scaleMax - scaleMin);
  t2 = Math.max(0, Math.min(1, t2));
  const stops = [
    { r: 180, g:   0, b:   0 },
    { r: 230, g:  60, b:   0 },
    { r: 255, g: 150, b:   0 },
    { r: 255, g: 220, b:   0 },
    { r: 180, g: 230, b:  50 },
    { r:  80, g: 200, b:  40 },
    { r:  20, g: 160, b:  20 },
    { r:   0, g: 110, b:  10 },
    { r:   0, g:  60, b:   0 },
  ];
  const pos = t2 * (stops.length - 1);
  const lo = Math.floor(pos), hi = Math.min(lo + 1, stops.length - 1);
  const f = pos - lo;
  return {
    r: Math.round(stops[lo].r + f * (stops[hi].r - stops[lo].r)),
    g: Math.round(stops[lo].g + f * (stops[hi].g - stops[lo].g)),
    b: Math.round(stops[lo].b + f * (stops[hi].b - stops[lo].b)),
  };
}

/**
 * Returns the geographic bounding box of the loaded GeoRaster as a
 * Leaflet LatLngBounds, reprojecting from the raster CRS to EPSG:4326
 * when necessary.
 * @returns {L.LatLngBounds}
 */
export function getGeoBounds() {
  const gr = state.georaster;
  const epsg = state.geotiffEPSG;
  if (!epsg || epsg === 'EPSG:4326') {
    return L.latLngBounds([gr.ymin, gr.xmin], [gr.ymax, gr.xmax]);
  }
  try {
    const sw = proj4(epsg, 'EPSG:4326', [gr.xmin, gr.ymin]);
    const ne = proj4(epsg, 'EPSG:4326', [gr.xmax, gr.ymax]);
    return L.latLngBounds([sw[1], sw[0]], [ne[1], ne[0]]);
  } catch (e) {
    return L.latLngBounds([gr.ymin, gr.xmin], [gr.ymax, gr.xmax]);
  }
}

// ==========================================
// DISPLAY NDVI
// ==========================================
/**
 * Renders the loaded GeoRaster as a colourised index overlay on the map.
 * For RGB-proxy TIFs (e.g. DJI Plant Health) the raw pixel values are
 * painted directly. For spectral TIFs the chosen VI formula is applied
 * per pixel and the result is colourised with ndviToRGB().
 *
 * Results are cached in `state.ndviGrid` (Float32Array) and
 * `state.ndviHistogramData` for later use by the histogram and taskmap.
 */
export function displayNDVI() {
  ndviOverlay.clearLayers();
  const gr = state.georaster;
  const stretchCheck = document.querySelector('#stretch-ndvi');

  if (state.isRGBProxy) {
    const canvas = document.createElement('canvas');
    canvas.width = gr.width; canvas.height = gr.height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(gr.width, gr.height);
    const px = imgData.data;
    const hasAlpha = gr.numberOfRasters >= 4;

    const proxyGrid = new Float32Array(gr.width * gr.height);
    proxyGrid.fill(NaN);
    const HIST_BINS_P = 100, histBinMinP = -0.2, histBinMaxP = 1.0;
    const histCountsP = new Float32Array(HIST_BINS_P);
    for (let row = 0; row < gr.height; row++) {
      for (let col = 0; col < gr.width; col++) {
        const oi = row * gr.width + col;
        const idx = oi << 2;
        const rv = gr.values[0][row][col];
        const gv = gr.values[1][row][col];
        const bv = gr.values[2][row][col];
        const av = hasAlpha ? gr.values[3][row][col] : 255;
        if (av === 0) continue;
        px[idx] = rv; px[idx + 1] = gv; px[idx + 2] = bv;
        px[idx + 3] = Math.round(av * 0.85);
        const sum = gv + rv;
        if (sum > 0) {
          const pndvi = (gv - rv) / sum;
          proxyGrid[oi] = pndvi;
          const bip = Math.floor((pndvi - histBinMinP) / (histBinMaxP - histBinMinP) * HIST_BINS_P);
          histCountsP[Math.max(0, Math.min(HIST_BINS_P - 1, bip))]++;
        }
      }
    }
    state.ndviGrid = proxyGrid;
    state.ndviHistogramData = { counts: histCountsP, min: histBinMinP, max: histBinMaxP };
    state.ndviScaleMin = histBinMinP;
    state.ndviScaleMax = histBinMaxP;
    ctx.putImageData(imgData, 0, 0);
    state.ndviLayer = L.imageOverlay(canvas.toDataURL('image/png'), getGeoBounds(), { opacity: 1 });
    ndviOverlay.addLayer(state.ndviLayer);
    legend.addTo(map);
    showLegendInPanel();
    return;
  }

  const isP  = state.isPreCalc;
  const bR   = state.bandRed, bG = state.bandGreen, bN = state.bandNIR, bRE = state.bandRedEdge;
  const vi   = state.selectedVI || 'NDVI';
  const noData = gr.noDataValue;
  const isFloat = state.bandMetas.length > 0 && state.bandMetas[0].sampleFormat === 3;
  const noDataEps = (isFloat && noData !== null) ? 1e-6 : 0;
  function nd(v) { return v === null || isNaN(v) || (noData !== null && (noDataEps > 0 ? Math.abs(v - noData) < noDataEps : v === noData)); }
  const stretch = stretchCheck && stretchCheck.checked;
  const maxBandIdx = Math.max(bR || 0, bG || 0, bN || 0, bRE || 0);
  const hasAlpha = gr.numberOfRasters >= 2 && state.bandMetas.length > 0 && (gr.numberOfRasters > maxBandIdx + 1);
  const alphaBand = hasAlpha ? gr.numberOfRasters - 1 : -1;

  const canvas = document.createElement('canvas');
  canvas.width = gr.width; canvas.height = gr.height;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(gr.width, gr.height);
  const px = imgData.data;
  let ndviMin = Infinity, ndviMax = -Infinity, ndviCount = 0;

  const ndviGrid = new Float32Array(gr.width * gr.height);
  ndviGrid.fill(NaN);
  for (let row = 0; row < gr.height; row++) {
    for (let col = 0; col < gr.width; col++) {
      if (alphaBand >= 0 && gr.values[alphaBand][row][col] === 0) continue;
      let ndvi;
      if (isP) {
        const v = gr.values[0][row][col];
        if (nd(v)) continue;
        ndvi = v;
      } else {
        const b1v = gr.values[bN][row][col];
        const b2v = vi === 'GNDVI' ? gr.values[bG][row][col] : vi === 'NDRE' ? gr.values[bRE][row][col] : gr.values[bR][row][col];
        if (nd(b1v) || nd(b2v)) continue;
        const s = b1v + b2v;
        if (s === 0) continue;
        if (vi === 'SAVI') ndvi = 1.5 * (b1v - b2v) / (b1v + b2v + 0.5);
        else if (vi === 'OSAVI') ndvi = (b1v - b2v) / (b1v + b2v + 0.16);
        else ndvi = (b1v - b2v) / s;
        if (ndvi < -1 || ndvi > 1) continue;
      }
      ndviGrid[row * gr.width + col] = ndvi;
      if (ndvi < ndviMin) ndviMin = ndvi;
      if (ndvi > ndviMax) ndviMax = ndvi;
      ndviCount++;
    }
  }
  state.ndviGrid = ndviGrid;

  let scaleMin = -0.2, scaleMax = 1.0;
  if (stretch && ndviCount > 0) {
    const sortedVals = [];
    for (let si = 0; si < ndviGrid.length; si++) { if (!isNaN(ndviGrid[si])) sortedVals.push(ndviGrid[si]); }
    sortedVals.sort((a, b) => a - b);
    const p2  = sortedVals[Math.max(0, Math.floor(sortedVals.length * 0.02))];
    const p98 = sortedVals[Math.min(sortedVals.length - 1, Math.floor(sortedVals.length * 0.98))];
    const margin = Math.max(0.01, (p98 - p2) * 0.02);
    scaleMin = Math.max(-1, p2  - margin);
    scaleMax = Math.min( 1, p98 + margin);
    if (scaleMax <= scaleMin) scaleMax = scaleMin + 0.01;
    console.log('[Stretch] p2=' + p2.toFixed(3) + ' p98=' + p98.toFixed(3) + ' scale=' + scaleMin.toFixed(3) + '..' + scaleMax.toFixed(3));
  }

  const HIST_BINS = 100;
  const histCounts = new Float32Array(HIST_BINS);
  for (let hi = 0; hi < ndviGrid.length; hi++) {
    const hv = ndviGrid[hi];
    if (!isNaN(hv)) {
      const bi = Math.floor((hv - scaleMin) / (scaleMax - scaleMin) * HIST_BINS);
      histCounts[Math.max(0, Math.min(HIST_BINS - 1, bi))]++;
    }
  }
  state.ndviHistogramData = { counts: histCounts, min: scaleMin, max: scaleMax };
  state.ndviScaleMin = scaleMin;
  state.ndviScaleMax = scaleMax;

  for (let row = 0; row < gr.height; row++) {
    for (let col = 0; col < gr.width; col++) {
      const ndvi = ndviGrid[row * gr.width + col];
      if (isNaN(ndvi)) continue;
      const rgb = ndviToRGB(ndvi, scaleMin, scaleMax);
      if (!rgb) continue;
      const idx = (row * gr.width + col) << 2;
      px[idx] = rgb.r; px[idx + 1] = rgb.g; px[idx + 2] = rgb.b; px[idx + 3] = 217;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  if (ndviCount > 0) {
    console.log('[NDVI] min=' + ndviMin.toFixed(3) + ' max=' + ndviMax.toFixed(3) + ' pixels=' + ndviCount + ' noData=' + noData + ' bR=' + bR + ' bN=' + bN + ' stretch=' + stretch);
    const statsEl = document.querySelector('#info-ndvi-range');
    if (statsEl) statsEl.textContent = ndviMin.toFixed(3) + ' \u2013 ' + ndviMax.toFixed(3);
    const statsRow = document.querySelector('#ndvi-stats-row');
    if (statsRow) statsRow.classList.remove('hidden');
  } else {
    console.warn('[NDVI] Geen geldige pixels! noData=' + noData + ' bR=' + bR + ' bN=' + bN);
    toast(t('toastNoValidPixels'), true);
  }

  state.ndviLayer = L.imageOverlay(canvas.toDataURL('image/png'), getGeoBounds(), { opacity: 1 });
  ndviOverlay.addLayer(state.ndviLayer);
  legend.addTo(map);
  showLegendInPanel();
  setTimeout(() => { if (ndviCount > 0) setLegendLabels(scaleMin, scaleMax); }, 50);
}

/** Fits the map viewport to the bounds of the loaded GeoTIFF. */
export function zoomToGeoTIFF() {
  map.fitBounds(getGeoBounds(), { padding: [30, 30] });
}

// ==========================================
// HISTOGRAM
// ==========================================
/**
 * Redraws the NDVI histogram <canvas> using binned count data stored in
 * `state.ndviHistogramData`.  Overlays vertical lines at each class boundary
 * with the dosage rate labelled in white.
 */
export function drawNDVIHistogram() {
  const wrap   = document.getElementById('ndvi-histogram-wrap');
  const canvas = document.getElementById('ndvi-histogram');
  if (!canvas) return;
  const data = state.ndviHistogramData;
  if (!data) { if (wrap) wrap.style.display = 'none'; return; }
  if (wrap) wrap.style.display = '';
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.offsetWidth || 300;
  canvas.width  = cssW * dpr;
  canvas.height = 60 * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = cssW, h = 60;
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, w, h);
  const counts = data.counts, n = counts.length;
  let maxCnt = 0;
  for (let i = 0; i < n; i++) if (counts[i] > maxCnt) maxCnt = counts[i];
  if (!maxCnt) return;
  const bw = w / n;
  for (let i = 0; i < n; i++) {
    if (!counts[i]) continue;
    const barH = (counts[i] / maxCnt) * (h - 6);
    const v = data.min + (i + 0.5) / n * (data.max - data.min);
    const rgb = ndviToRGB(v, data.min, data.max);
    ctx.fillStyle = 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')';
    ctx.fillRect(i * bw, h - barH, bw + 0.5, barH);
  }
  state.classes.forEach(function (cls) {
    const x0 = (cls.min - data.min) / (data.max - data.min) * w;
    const x1 = (cls.max - data.min) / (data.max - data.min) * w;
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    if (x0 > 0 && x0 < w) { ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0, h); ctx.stroke(); }
    if (x1 > 0 && x1 < w) { ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, h); ctx.stroke(); }
    ctx.globalAlpha = 1;
    if (x1 - x0 > 18) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(cls.rate, Math.min(Math.max((x0 + x1) / 2, 12), w - 12), 10);
    }
  });
}

// ==========================================
// PARCEL CLIPPING
// ==========================================
/**
 * Re-renders the NDVI overlay clipped to the selected parcel geometries.
 * Uses an off-screen 2D canvas as a rasterised mask so that only pixels
 * inside the selected polygons are shown, while the histogram is updated
 * to reflect only values within that area.
 * @param {object[]|null} parcels - Array of GeoJSON feature geometries, or
 *   null to show the full (unclipped) raster.
 */
export function clipNDVIToParcel(parcels) {
  const gr = state.georaster;
  const ndviGrid = state.ndviGrid;
  if (!gr || !ndviGrid) {
    console.warn('[Clip] Afgebroken: gr=' + !!gr + ' ndviGrid=' + !!ndviGrid);
    return;
  }
  const epsg = state.geotiffEPSG;
  const stretchCheck = document.querySelector('#stretch-ndvi');
  const stretch = stretchCheck && stretchCheck.checked;
  console.log('[Clip] Start: parcels=' + (parcels ? parcels.length : 'null') + ' epsg=' + epsg + ' raster=' + gr.width + 'x' + gr.height + ' stretch=' + stretch);

  const w = gr.width, h = gr.height;
  const mask = new Uint8Array(w * h);

  if (!parcels) {
    for (let mi = 0; mi < mask.length; mi++) mask[mi] = 1;
  } else {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = w; maskCanvas.height = h;
    const mctx = maskCanvas.getContext('2d');
    mctx.fillStyle = '#fff';

    for (let pi = 0; pi < parcels.length; pi++) {
      const geom = parcels[pi].geometry || parcels[pi];
      let rings = [];
      if (geom.type === 'Polygon') rings = geom.coordinates;
      else if (geom.type === 'MultiPolygon') {
        for (let mp = 0; mp < geom.coordinates.length; mp++) rings = rings.concat(geom.coordinates[mp]);
      } else continue;

      for (let ri2 = 0; ri2 < rings.length; ri2++) {
        const ring = rings[ri2];
        if (ring.length < 3) continue;
        mctx.beginPath();
        for (let vi2 = 0; vi2 < ring.length; vi2++) {
          let cx = ring[vi2][0], cy = ring[vi2][1];
          if (epsg && epsg !== 'EPSG:4326') {
            try { const pp = proj4('EPSG:4326', epsg, [cx, cy]); cx = pp[0]; cy = pp[1]; } catch (e) { continue; }
          }
          const pc = (cx - gr.xmin) / gr.pixelWidth;
          const pr = (gr.ymax - cy) / Math.abs(gr.pixelHeight);
          if (vi2 === 0) mctx.moveTo(pc, pr); else mctx.lineTo(pc, pr);
        }
        mctx.closePath();
        if (ri2 === 0 || rings.length === 1) mctx.fill(); else mctx.fill('evenodd');
      }
    }

    const mdata = mctx.getImageData(0, 0, w, h).data;
    for (let mi2 = 0; mi2 < mask.length; mi2++) { if (mdata[mi2 << 2] > 0) mask[mi2] = 1; }
    let maskedCount = 0;
    for (let mc = 0; mc < mask.length; mc++) if (mask[mc]) maskedCount++;
    console.log('[Clip] masked pixels=' + maskedCount + ' / ' + mask.length);
    if (maskedCount === 0) {
      console.warn('[Clip] 0 masked pixels');
      toast(t('toastOutsideRaster'), 'warn');
      return;
    }
  }

  const vals = [];
  for (let vi = 0; vi < ndviGrid.length; vi++) { if (mask[vi] && !isNaN(ndviGrid[vi])) vals.push(ndviGrid[vi]); }
  if (vals.length === 0) { toast(t('toastNoValidNDVI'), 'warn'); return; }

  const scaleMin = (state.ndviScaleMin != null) ? state.ndviScaleMin : -0.2;
  const scaleMax = (state.ndviScaleMax != null) ? state.ndviScaleMax : 1.0;

  const HIST_BINS = 100;
  const histCounts = new Float32Array(HIST_BINS);
  for (let hi = 0; hi < ndviGrid.length; hi++) {
    if (!mask[hi]) continue;
    const hv = ndviGrid[hi];
    if (!isNaN(hv)) {
      const bi = Math.floor((hv - scaleMin) / (scaleMax - scaleMin) * HIST_BINS);
      histCounts[Math.max(0, Math.min(HIST_BINS - 1, bi))]++;
    }
  }
  state.ndviHistogramData = { counts: histCounts, min: scaleMin, max: scaleMax };

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(w, h);
  const px = imgData.data;

  if (state.isRGBProxy) {
    const hasAlphaP = gr.numberOfRasters >= 4;
    for (let ri = 0; ri < h; ri++) {
      for (let ci = 0; ci < w; ci++) {
        const oi = ri * w + ci;
        if (!mask[oi]) continue;
        const av = hasAlphaP ? gr.values[3][ri][ci] : 255;
        if (av === 0) continue;
        const pi2 = oi << 2;
        px[pi2] = gr.values[0][ri][ci]; px[pi2 + 1] = gr.values[1][ri][ci];
        px[pi2 + 2] = gr.values[2][ri][ci]; px[pi2 + 3] = Math.round(av * 0.85);
      }
    }
  } else {
    for (let ri = 0; ri < h; ri++) {
      for (let ci = 0; ci < w; ci++) {
        const oi = ri * w + ci;
        if (!mask[oi]) continue;
        const nv = ndviGrid[oi];
        if (isNaN(nv)) continue;
        const rgb = ndviToRGB(nv, scaleMin, scaleMax);
        if (!rgb) continue;
        const pi2 = oi << 2;
        px[pi2] = rgb.r; px[pi2 + 1] = rgb.g; px[pi2 + 2] = rgb.b; px[pi2 + 3] = 217;
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);

  ndviOverlay.clearLayers();
  state.ndviLayer = L.imageOverlay(canvas.toDataURL('image/png'), getGeoBounds(), { opacity: 1 });
  ndviOverlay.addLayer(state.ndviLayer);

  setTimeout(() => setLegendLabels(scaleMin, scaleMax), 50);
  drawNDVIHistogram();
}

// ==========================================
// AUTO CLASSIFY
// ==========================================
/**
 * Divides the current VI histogram into `state.classes.length` equal-area
 * buckets by walking the cumulative bin count.  Updates `state.classes[].min`
 * and `.max` in place, then dispatches the `ndvi:autoclassify` CustomEvent
 * so taskmap.js can re-render without creating a circular import.
 */
export function autoClassifyFromData() {
  const { t, tf } = window;
  const data = state.ndviHistogramData;
  if (!data) { toast(t('toastNoNDVI'), true); return; }
  const counts = data.counts, n = counts.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += counts[i];
  if (!total) return;
  const numCls = state.classes.length;
  const target = total / numCls;
  const bounds = [data.min];
  let cum = 0;
  for (let i = 0; i < n && bounds.length < numCls; i++) {
    cum += counts[i];
    if (cum >= target * bounds.length)
      bounds.push(Math.round((data.min + (i + 1) / n * (data.max - data.min)) * 1000) / 1000);
  }
  while (bounds.length < numCls) bounds.push(data.max);
  bounds.push(data.max);
  state.classes.forEach((cls, i) => { cls.min = bounds[i]; cls.max = bounds[i + 1]; });
  // renderClasses and liveRegenerate are imported by taskmap.js; use an event
  window.dispatchEvent(new CustomEvent('ndvi:autoclassify'));
  toast(tf('toastClassesSet', numCls));
}
