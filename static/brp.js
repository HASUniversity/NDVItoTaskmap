/* ===================================================
   brp.js — BRP parcel loading, selection & crop history

   Integrates with the Dutch PDOK BRP Gewaspercelen WFS
   (OGC WFS 2.0, GML bbox filter) to fetch agricultural
   parcel boundaries within the current map viewport.

   Main responsibilities:
     - Map-move debounced WFS loader (loadBRP)
     - Per-parcel click selection + highlight (toggleParcel)
     - Parcel-clipped NDVI overlay update
     - Crop history sidebar with per-parcel caching
   =================================================== */

import { state, BRP_WFS_URL, MIN_ZOOM_BRP } from './state.js?v=1';
import { debounce, toast, escapeHtml } from './utils.js?v=1';
import { map, brpOverlay, selectionOverlay, clearLegendCrop, updateLegendCrop, updateLayerVisibility } from './map.js?v=1';
import { clipNDVIToParcel, drawNDVIHistogram, autoClassifyFromData } from './ndvi.js?v=1';
import { activateStep } from './steps.js?v=1';
import { renderClasses } from './taskmap.js?v=1';

const { t, tf } = window;

// Tracks the in-flight WFS request so a newer map move can cancel it.
let _brpAbortController = null;

/**
 * Returns true when features `a` and `b` refer to the same parcel.
 * Prefers id-based comparison; falls back to geometry serialisation.
 * @param {object} a - GeoJSON Feature
 * @param {object} b - GeoJSON Feature
 * @returns {boolean}
 */
function _sameFeature(a, b) {
  if (a.id && b.id) return a.id === b.id;
  return JSON.stringify(a.geometry) === JSON.stringify(b.geometry);
}

/**
 * Builds a WFS 2.0.0 XML POST body targeting the BRP Gewaspercelen
 * endpoint. Only the `<fes:Filter>…</fes:Filter>` fragment varies per
 * call site (BBOX, Intersects, etc.).
 * @param {string}  filterXml - The filter fragment (without outer `<fes:Filter>`).
 * @param {number}  [count]   - Optional feature count limit.
 * @returns {string} Complete WFS XML body.
 */
function _wfsBody(filterXml, count) {
  const countAttr = count ? ' count="' + count + '"' : '';
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    '<wfs:GetFeature service="WFS" version="2.0.0"' + countAttr + ' ' +
    'xmlns:wfs="http://www.opengis.net/wfs/2.0" ' +
    'xmlns:fes="http://www.opengis.net/fes/2.0" ' +
    'xmlns:gml="http://www.opengis.net/gml/3.2" ' +
    'xmlns:brpgewaspercelen="http://brpgewaspercelen.geonovum.nl" ' +
    'outputFormat="application/json">' +
    '<wfs:Query typeNames="brpgewaspercelen:BrpGewas" srsName="urn:ogc:def:crs:EPSG::4326">' +
    '<fes:Filter>' + filterXml + '</fes:Filter>' +
    '</wfs:Query>' +
    '</wfs:GetFeature>';
}

// ==========================================
// BRP LOADING
// ==========================================
/**
 * Starts the BRP loading loop: loads immediately for the current viewport
 * and re-loads on every subsequent map `moveend` event (debounced 600 ms).
 * Should be called once after a GeoTIFF has been successfully computed.
 */
export function startBRPLoading() {
  loadBRP();
  map.on('moveend', debounce(loadBRP, 600));
}

async function loadBRP() {
  if (map.getZoom() < MIN_ZOOM_BRP) {
    const h = document.querySelector('#parcel-hint');
    if (h) { h.textContent = tf('parcelHintZoom', MIN_ZOOM_BRP); h.classList.remove('hidden'); }
    return;
  }
  // Cancel any superseded in-flight request and start a fresh one.
  if (_brpAbortController) _brpAbortController.abort();
  _brpAbortController = new AbortController();
  const { signal } = _brpAbortController;

  const hint = document.querySelector('#parcel-hint');
  if (hint) hint.textContent = t('parcelHintLoading');
  state.brpLoading = true;

  try {
    const b = map.getBounds();
    const sw = proj4('EPSG:4326', 'EPSG:28992', [b.getWest(), b.getSouth()]);
    const ne = proj4('EPSG:4326', 'EPSG:28992', [b.getEast(), b.getNorth()]);

    const body = _wfsBody(
      '<fes:BBOX>' +
      '<fes:ValueReference>brpgewaspercelen:geom</fes:ValueReference>' +
      '<gml:Envelope srsName="EPSG:28992">' +
      '<gml:lowerCorner>' + sw[0] + ' ' + sw[1] + '</gml:lowerCorner>' +
      '<gml:upperCorner>' + ne[0] + ' ' + ne[1] + '</gml:upperCorner>' +
      '</gml:Envelope>' +
      '</fes:BBOX>',
      500
    );

    const resp = await fetch(BRP_WFS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
      body,
      signal,
    });
    if (!resp.ok) throw new Error('WFS ' + resp.status);

    const data = await resp.json();
    state.brpGeoJSON = data;

    brpOverlay.clearLayers();
    state.brpLayerMap = {};
    state.brpLayer = L.geoJSON(data, {
      style: () => ({ color: '#FFE000', weight: 3, fill: true, fillOpacity: 0.06, opacity: 1 }),
      onEachFeature: function (feature, layer) {
        const fkey = feature.id || JSON.stringify(feature.geometry).slice(0, 80);
        if (state.brpLayerMap) state.brpLayerMap[fkey] = { layer, feature };
        layer.on('mouseover', function () {
          if (isParcelSelected(feature)) return;
          layer.setStyle({ fillOpacity: 0.18, weight: 4 });
        });
        layer.on('mouseout', function () {
          if (isParcelSelected(feature)) {
            layer.setStyle({ color: '#0066FF', weight: 5, fillOpacity: 0 });
          } else {
            layer.setStyle({ color: '#FFE000', fillColor: null, fillOpacity: 0.06, weight: 3 });
          }
        });
        layer.on('click', function (ev) {
          L.DomEvent.stopPropagation(ev);
          toggleParcel(feature);
        });
      }
    }).addTo(brpOverlay);

    const count = data.features ? data.features.length : 0;
    if (hint) hint.textContent = tf('parcelHintLoaded', count);
    refreshBRPLayerStyles();
    updateLayerVisibility();
    // Keep selection overlay on top after BRP re-render
    if (state.selectedParcels.length > 0) selectionOverlay.bringToFront();
  } catch (err) {
    if (err.name === 'AbortError') return; // superseded by a newer request
    console.error('BRP laden mislukt:', err);
    const hint = document.querySelector('#parcel-hint');
    if (hint) hint.textContent = t('parcelHintFailed');
  } finally {
    state.brpLoading = false;
  }
}

// ==========================================
// PARCEL SELECTION
// ==========================================
/**
 * Returns true if `feature` is already in the selection list.
 * Identity is checked by feature id when available, falling back to
 * geometry serialisation for anonymous features.
 * @param {object} feature - GeoJSON Feature.
 * @returns {boolean}
 */
export function isParcelSelected(feature) {
  return state.selectedParcels.some(function (f) { return _sameFeature(f, feature); });
}

/**
 * Applies the correct Leaflet style to every BRP layer entry based on
 * whether it is currently selected.  Selected parcels use a thicker yellow
 * border; unselected parcels revert to the default yellow outline.
 */
export function refreshBRPLayerStyles() {
  if (!state.brpLayerMap) return;
  Object.values(state.brpLayerMap).forEach(function (entry) {
    if (isParcelSelected(entry.feature)) {
      entry.layer.setStyle({ color: '#0066FF', weight: 5, fillOpacity: 0 });
    } else {
      entry.layer.setStyle({ color: '#FFE000', fillColor: null, fillOpacity: 0.06, weight: 3 });
    }
  });
}

/**
 * Adds or removes `feature` from the selection list and refreshes styles.
 * Triggers a NDVI clip update after every change.
 * @param {object} feature - GeoJSON Feature to toggle.
 */
export function toggleParcel(feature) {
  let idx = -1;
  for (let i = 0; i < state.selectedParcels.length; i++) {
    if (_sameFeature(state.selectedParcels[i], feature)) { idx = i; break; }
  }
  const wasEmpty = state.selectedParcels.length === 0;
  if (idx >= 0) { state.selectedParcels.splice(idx, 1); toast(t('toastParcelRemoved')); }
  else { state.selectedParcels.push(feature); toast(tf('toastParcelAdded', state.selectedParcels.length)); }
  refreshBRPLayerStyles();
  updateSelectionDisplay(wasEmpty && state.selectedParcels.length > 0);
}

/**
 * Rebuilds the selection overlay layer and the parcel info panel.
 * Triggers a NDVI clip update and, on the first parcel addition, fits
 * the map to the selected parcel bounds.
 * @param {boolean} fitBounds - Whether to fit the map view to the selection.
 */
export function updateSelectionDisplay(fitBounds) {
  selectionOverlay.clearLayers();

  // AHN and Bodemkaart are full-viewport WMS layers, no need to refresh

  if (state.selectedParcels.length === 0) {
    document.querySelector('#parcel-info').classList.add('hidden');
    clearLegendCrop();
    if (state.ndviGrid && state.georaster) clipNDVIToParcel(null);
    updateLayerVisibility();
    return;
  }

  const fc = { type: 'FeatureCollection', features: state.selectedParcels };
  state.selectedParcelsLayer = L.geoJSON(fc, {
    style: { color: '#0066FF', weight: 5, fillOpacity: 0, interactive: false }
  }).addTo(selectionOverlay);
  selectionOverlay.bringToFront();

  if (fitBounds) map.fitBounds(state.selectedParcelsLayer.getBounds(), { padding: [60, 60] });

  let totalArea = 0;
  state.selectedParcels.forEach(f => { try { totalArea += turf.area(f); } catch (e) {} });
  document.querySelector('#parcel-count').textContent = state.selectedParcels.length === 1
    ? tf('parcelCount1', state.selectedParcels.length)
    : tf('parcelCountN', state.selectedParcels.length);
  document.querySelector('#parcel-area').textContent = (totalArea / 10000).toFixed(2) + ' ha';

  const listEl = document.querySelector('#parcel-list');
  if (listEl) {
    listEl.innerHTML = state.selectedParcels.map((f, i) => {
      const props = f.properties || {};
      const name = props.gewas || props.gewasgroep || props.GWS_GEWAS || tf('parcelN', i + 1);
      let area = '?';
      try { area = (turf.area(f) / 10000).toFixed(2) + ' ha'; } catch (e) {}
      return '<div class="parcel-hist-item">' +
        '<div class="phi-header">' +
        '<span class="phi-name">' + escapeHtml(name) + ' <span class="phi-area">— ' + escapeHtml(area) + '</span></span>' +
        '<button class="remove-parcel" data-i="' + i + '">×</button>' +
        '</div>' +
        '<div class="phi-hist" id="phi-hist-' + i + '"><span class="phi-loading">' + t('cropHistLoading') + '</span></div>' +
        '</div>';
    }).join('');
    listEl.querySelectorAll('.remove-parcel').forEach(btn => {
      btn.addEventListener('click', function () {
        state.selectedParcels.splice(parseInt(btn.dataset.i), 1);
        refreshBRPLayerStyles();
        updateSelectionDisplay(false);
      });
    });
    state.selectedParcels.forEach((parcel, i) => loadParcelHistory(parcel, i));
  }

  document.querySelector('#parcel-info').classList.remove('hidden');
  // Auto-advance to Data Analyse (step 4) when parcels are selected.
  if (state.ndviGrid && state.georaster) {
    console.log('[Selection] Calling clipNDVIToParcel' + (state.classificationMethod !== 'manual' ? ' + autoClassifyFromData' : ''));
    clipNDVIToParcel(state.selectedParcels);
    if (state.classificationMethod !== 'manual') {
      autoClassifyFromData();
    }
    // Advance to Data Analyse step if we're still on step 2 (Percelen)
    if (state.currentStep === 2) {
      activateStep(4);
    }
  } else {
    console.warn('[Selection] No ndviGrid or georaster - skipping clip+classify');
  }
  renderClasses();
  updateLayerVisibility();
}

// "Continue → Data Analyse" handler is now in taskmap.js

// ==========================================
// MAP CLICK FALLBACK
// ==========================================
// At low zoom levels the BRP layer is not loaded. This listener
// performs a point-query WFS request so users can still select
// parcels by clicking the map when the layer hasn't pre-loaded.
map.on('click', async function (e) {
  if (state.currentStep < 2 || !state.georaster) return;
  if (map.getZoom() < MIN_ZOOM_BRP) return;
  if (state.brpLayer && state.brpGeoJSON && state.brpGeoJSON.features && state.brpGeoJSON.features.length > 0) return;
  try {
    const pt = proj4('EPSG:4326', 'EPSG:28992', [e.latlng.lng, e.latlng.lat]);
    const body = _wfsBody(
      '<fes:Intersects>' +
      '<fes:ValueReference>brpgewaspercelen:geom</fes:ValueReference>' +
      '<gml:Point srsName="EPSG:28992"><gml:pos>' + pt[0] + ' ' + pt[1] + '</gml:pos></gml:Point>' +
      '</fes:Intersects>'
    );
    const resp = await fetch(BRP_WFS_URL, { method: 'POST', headers: { 'Content-Type': 'text/xml;charset=UTF-8' }, body });
    const data = await resp.json();
    if (data.features && data.features.length > 0) {
      toggleParcel(data.features[0]);
    }
  } catch (err) { console.error(err); }
});

// Clear all selected parcels button
const clearParcelsBtn = document.querySelector('#clear-parcels-btn');
if (clearParcelsBtn) {
  clearParcelsBtn.addEventListener('click', function () {
    state.selectedParcels = [];
    refreshBRPLayerStyles();
    updateSelectionDisplay(false);
    toast(t('toastSelectionCleared'));
  });
}

// AHN is now controlled via the legend (ULC panel) — no sidebar selector needed

// ==========================================
// CROP HISTORY
// ==========================================
/**
 * Returns a stable cache key for a parcel based on its centroid
 * coordinates, rounded to 4 decimal degrees (~11 m precision).
 * @param {object} feature - GeoJSON Feature.
 * @returns {string}
 */
function parcelKey(feature) {
  try {
    const c = turf.centroid(feature).geometry.coordinates;
    return c[0].toFixed(4) + ',' + c[1].toFixed(4);
  } catch (e) {
    return JSON.stringify((feature.properties || {})).substring(0, 60);
  }
}

function renderParcelHistory(histEl, byYear) {
  const years = Object.keys(byYear).sort((a, b) => Number(b) - Number(a));
  if (years.length === 0) {
    histEl.innerHTML = '<span class="phi-none">' + t('cropHistNone') + '</span>';
    return;
  }
  histEl.innerHTML = years.map(y =>
    '<div class="phi-row"><span class="phi-yr">' + escapeHtml(y) +
    '</span><span class="phi-crop">' + escapeHtml(byYear[y]) + '</span></div>'
  ).join('');
}

async function loadParcelHistory(feature, idx) {
  const histEl = document.getElementById('phi-hist-' + idx);
  if (!histEl) return;

  const key = parcelKey(feature);
  if (state.parcelHistoryCache[key]) {
    renderParcelHistory(histEl, state.parcelHistoryCache[key]);
    return;
  }

  let centroid;
  try { centroid = turf.centroid(feature).geometry.coordinates; }
  catch (e) { histEl.innerHTML = '<span class="phi-error">' + t('cropHistError') + '</span>'; return; }

  const pt28992 = proj4('EPSG:4326', 'EPSG:28992', centroid);
  const body = _wfsBody(
    '<fes:Intersects>' +
    '<fes:ValueReference>brpgewaspercelen:geom</fes:ValueReference>' +
    '<gml:Point srsName="EPSG:28992"><gml:pos>' + pt28992[0] + ' ' + pt28992[1] + '</gml:pos></gml:Point>' +
    '</fes:Intersects>',
    50
  );

  try {
    const resp = await fetch(BRP_WFS_URL, { method: 'POST', headers: { 'Content-Type': 'text/xml;charset=UTF-8' }, body });
    if (!resp.ok) throw new Error('WFS ' + resp.status);
    const data = await resp.json();

    const byYear = {};
    (data.features || []).forEach(f => {
      const p = f.properties || {};
      const year = p.registratiejaar || p.RegistratieJaar || p.jaar || '?';
      const crop = p.gewas || p.GWS_GEWAS || p.gewasgroep || p.gewascode || '—';
      if (!byYear[year]) byYear[year] = crop;
    });

    state.parcelHistoryCache[key] = byYear;
    const el = document.getElementById('phi-hist-' + idx);
    if (el) renderParcelHistory(el, byYear);
    updateLegendCrop(feature, byYear);
  } catch (err) {
    console.warn('Gewasgeschiedenis laden mislukt:', err);
    const el = document.getElementById('phi-hist-' + idx);
    if (el) el.innerHTML = '<span class="phi-error">' + t('cropHistNA') + '</span>';
  }
}
