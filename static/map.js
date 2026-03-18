/* ===================================================
   map.js — Leaflet map setup, basemaps, layer control, legend

   Initialises the Leaflet map and all overlay layer groups
   at module load time.  Also creates the Unified Layer Control
   (ULC) that merges basemap switching, overlay toggles and the
   NDVI legend into a single responsive panel.

   Exported symbols:
     map               — L.Map instance
     basemaps          — { name: TileLayer } record
     ndviOverlay       — LayerGroup for the VI canvas overlay
     selectionOverlay  — LayerGroup for selected parcel outlines
     brpOverlay        — LayerGroup for BRP parcel boundaries
     gridOverlay       — LayerGroup for the task-map grid
     legend            — compatibility stub (legend lives inside ULC)
     isMobileUI()      — true on touch screens ≤ 768 px wide
     syncLayerControlLayout() / syncMobilePaneToggle()
                       — responsive layout helpers, called on resize
     setLegendLabels() / showLegendInPanel() / updateLegendCrop()
                       — legend update helpers called by ndvi.js / brp.js
   =================================================== */

import { state } from './state.js';
import { escapeHtml } from './utils.js';

const { t } = window;

// ==========================================
// PROJ4 DEFINITIONS
// ==========================================
// Registered once at module load so all other modules can use
// proj4('EPSG:28992', 'EPSG:4326', coord) without extra setup.
proj4.defs('EPSG:28992', '+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +units=m +no_defs');
proj4.defs('EPSG:32631', '+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs');
proj4.defs('EPSG:32632', '+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs');

// ==========================================
// MAP + BASEMAPS
// ==========================================
export const map = L.map('map', { center: [52.1, 5.5], zoom: 8, zoomControl: false });
L.control.zoom({ position: 'topright' }).addTo(map);

export const basemaps = {
  'PDOK Luchtfoto': L.tileLayer(
    'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg',
    { attribution: 'PDOK', maxZoom: 19 }
  ),
  'Esri Satelliet': L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Esri, Maxar, Earthstar Geographics', maxZoom: 19 }
  ),
  'OpenStreetMap': L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '&copy; OpenStreetMap', maxZoom: 19 }
  ),
};
basemaps['Esri Satelliet'].addTo(map);

// Netherlands border outline — fetched from PDOK Bestuurlijke Gebieden WFS
(function addNLBorder() {
  const url = 'https://service.pdok.nl/kadaster/bestuurlijkegebieden/wfs/v1_0?' +
    'service=WFS&version=2.0.0&request=GetFeature' +
    '&typeName=bestuurlijkegebieden:Landgebied' +
    '&outputFormat=json&srsName=EPSG:4326&count=10';
  fetch(url)
    .then(r => r.json())
    .then(data => {
      if (!data.features || data.features.length === 0) return;
      L.geoJSON(data, {
        style: { color: '#FF6600', weight: 2, opacity: 0.7, dashArray: '6,4', fillOpacity: 0, interactive: false }
      }).addTo(map);
    })
    .catch(() => { /* silently ignore if PDOK is unreachable */ });
})();

// ==========================================
// LAYER GROUPS
// ==========================================
export const ndviOverlay       = L.layerGroup().addTo(map);
export const selectionOverlay  = L.layerGroup().addTo(map);
export const brpOverlay        = L.layerGroup().addTo(map);
export const gridOverlay       = L.layerGroup(); // added to map on first generateTaskMap()

// ==========================================
// MOBILE HELPERS
// ==========================================
/**
 * Returns true when the device is a narrow touch screen (phone / tablet).
 * Used to toggle between the desktop sidebar layout and the mobile
 * bottom-sheet layout.
 * @returns {boolean}
 */
export function isMobileUI() {
  return window.matchMedia('(max-width: 768px) and (hover: none) and (pointer: coarse)').matches;
}

function isMobileLegendMenu() {
  return isMobileUI();
}

// ==========================================
// UNIFIED LAYER CONTROL
// ==========================================
let _activeBasemap = 'Esri Satelliet';

function createLayerToggleButton(container, panel) {
  const toggleBtn = L.DomUtil.create('button', 'ulc-toggle', container);
  toggleBtn.title = t('lcLayers');
  toggleBtn.innerHTML =
    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="2" y="3" width="16" height="3" rx="1"/>' +
    '<rect x="2" y="9" width="16" height="3" rx="1"/>' +
    '<rect x="2" y="15" width="16" height="3" rx="1"/>' +
    '</svg>';
  toggleBtn.addEventListener('click', function () {
    panel.classList.toggle('hidden');
    toggleBtn.classList.toggle('active');
  });
  return toggleBtn;
}

/**
 * Sets the min / mid / max labels below the NDVI colour ramp gradient.
 * Called after the first NDVI render and after parcel clipping.
 * @param {number} minValue - Minimum VI value of the current display range.
 * @param {number} maxValue - Maximum VI value of the current display range.
 */
export function setLegendLabels(minValue, maxValue) {
  const mid = ((minValue + maxValue) / 2).toFixed(2);
  const markup = '<span>' + minValue.toFixed(2) + '</span><span>' + mid + '</span><span>' + maxValue.toFixed(2) + '</span>';
  ['legend-labels', 'mobile-legend-labels'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = markup;
  });
}

const LayerControlClass = L.Control.extend({
  options: { position: 'bottomright' },
  onAdd: function () {
    const div = L.DomUtil.create('div', 'ulc-wrap');
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);

    const panel = L.DomUtil.create('div', 'ulc-panel hidden', div);
    panel.innerHTML =
      '<div class="ulc-section-title" data-i18n="lcBackground">Achtergrond</div>' +
      '<label class="ulc-radio"><input type="radio" name="basemap" value="Esri Satelliet" checked> Esri Satelliet</label>' +
      '<label class="ulc-radio"><input type="radio" name="basemap" value="PDOK Luchtfoto"> PDOK Luchtfoto</label>' +
      '<label class="ulc-radio"><input type="radio" name="basemap" value="OpenStreetMap"> OpenStreetMap</label>' +
      '<div class="ulc-sep"></div>' +
      '<div class="ulc-section-title" data-i18n="lcLayers">Lagen</div>' +
      '<label class="ulc-check"><input type="checkbox" data-layer="ndvi" checked> \uD83C\uDF3F NDVI</label>' +
      '<label class="ulc-check"><input type="checkbox" data-layer="taakkaart"> <span data-i18n="lcTaskmap">\uD83D\uDCCB Taakkaart</span></label>' +
      '<label class="ulc-check"><input type="checkbox" data-layer="percelen" checked> <span data-i18n="lcParcels">\uD83D\uDFE1 Percelen</span></label>' +
      '<label class="ulc-check"><input type="checkbox" data-layer="selectie" checked> <span data-i18n="lcSelection">\u2705 Selectie</span></label>' +
      '<div class="ulc-sep ulc-ndvi-section" style="display:none"></div>' +
      '<div class="ulc-ndvi-section" style="display:none">' +
        '<div class="ulc-section-title" id="mobile-legend-title">NDVI</div>' +
        '<div class="legend-gradient"></div>' +
        '<div class="legend-labels" id="mobile-legend-labels"><span data-i18n="legendLow">' + t('legendLow') + '</span><span></span><span data-i18n="legendHigh">' + t('legendHigh') + '</span></div>' +
      '</div>' +
      '<div id="legend-parcel" style="display:none">' +
        '<div class="legend-parcel-sep"></div>' +
        '<div id="legend-parcel-content"></div>' +
      '</div>';

    div._panel = panel;
    div._toggleBtn = null;
    if (isMobileLegendMenu()) div._toggleBtn = createLayerToggleButton(div, panel);

    panel.querySelectorAll('input[name="basemap"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (!radio.checked) return;
        basemaps[_activeBasemap].remove();
        _activeBasemap = radio.value;
        basemaps[_activeBasemap].addTo(map);
      });
    });

    const overlayMap = {};
    panel.addEventListener('change', function (e) {
      const cb = e.target;
      if (!cb.dataset.layer) return;
      const key = cb.dataset.layer;
      const overlay = overlayMap[key];
      if (!overlay) return;
      if (cb.checked) map.addLayer(overlay); else map.removeLayer(overlay);
      if (key === 'percelen') {
        const selCb = panel.querySelector('input[data-layer="selectie"]');
        if (selCb && selCb.checked !== cb.checked) {
          selCb.checked = cb.checked;
          if (overlayMap.selectie) {
            if (cb.checked) map.addLayer(overlayMap.selectie);
            else map.removeLayer(overlayMap.selectie);
          }
        }
      }
    });

    div._overlayMap = overlayMap;
    return div;
  }
});

export const layerControlInstance = new LayerControlClass().addTo(map);

// Wire overlay references into the control
(function () {
  const om = layerControlInstance.getContainer()._overlayMap;
  if (om) {
    om.ndvi      = ndviOverlay;
    om.taakkaart = gridOverlay;
    om.percelen  = brpOverlay;
    om.selectie  = selectionOverlay;
  }
})();

export function syncLayerControlLayout() {
  const container = layerControlInstance && layerControlInstance.getContainer();
  if (!container) return;
  const panel = container._panel || container.querySelector('.ulc-panel');
  let toggleBtn = container._toggleBtn || container.querySelector('.ulc-toggle');
  if (!panel) return;
  const isMobile = isMobileLegendMenu();
  if (isMobile) {
    if (!toggleBtn) {
      toggleBtn = createLayerToggleButton(container, panel);
      container._toggleBtn = toggleBtn;
    }
    panel.classList.add('hidden');
    toggleBtn.classList.remove('active');
    return;
  }
  if (toggleBtn) { toggleBtn.remove(); container._toggleBtn = null; }
  panel.classList.remove('hidden');
  panel.style.display = 'flex';
}

export function syncMobilePaneToggle() {
  const btn = document.getElementById('mobile-toggle');
  if (!btn) return;
  btn.style.display = isMobileUI() ? 'flex' : 'none';
}

// ==========================================
// LEGEND HELPERS
// ==========================================

// Keep a stub `legend` object with addTo() so existing calls don't break.
export const legend = { addTo: function () { return this; } };

export function showLegendInPanel() {
  const dl = document.getElementById('desktop-legend');
  if (dl) dl.classList.remove('hidden');
  const title = document.getElementById('desktop-legend-title');
  if (title) title.textContent = state.selectedVI || 'NDVI';
  const mobileTitle = document.getElementById('mobile-legend-title');
  if (mobileTitle) mobileTitle.textContent = state.selectedVI || 'NDVI';
  document.querySelectorAll('.ulc-ndvi-section').forEach(el => { el.style.display = ''; });
}

export function updateLegendCrop(feature, byYear) {
  const container = document.getElementById('legend-parcel');
  const content   = document.getElementById('legend-parcel-content');
  if (!container || !content) return;
  const props = feature.properties || {};
  const currentCrop = props.gewas || props.GWS_GEWAS || props.gewasgroep || '—';
  const currentYear = props.registratiejaar || props.RegistratieJaar || '';
  let html = '<div class="lp-current"><span class="lp-crop">' + escapeHtml(currentCrop) + '</span>';
  if (currentYear) html += ' <span class="lp-year">' + escapeHtml(currentYear) + '</span>';
  html += '</div>';
  if (byYear) {
    const years = Object.keys(byYear).sort((a, b) => Number(b) - Number(a));
    const histRows = years.filter(y => String(y) !== String(currentYear));
    if (histRows.length > 0) {
      html += '<table class="lp-table">';
      histRows.forEach(y => {
        html += '<tr><td class="lp-yr">' + escapeHtml(y) + '</td><td class="lp-cn">' + escapeHtml(byYear[y]) + '</td></tr>';
      });
      html += '</table>';
    }
  }
  content.innerHTML = html;
  container.style.display = '';
}

export function clearLegendCrop() {
  const container = document.getElementById('legend-parcel');
  if (container) container.style.display = 'none';
}
