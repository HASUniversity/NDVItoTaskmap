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

import { state, VEGETATION_INDICES } from './state.js?v=1';
import { escapeHtml } from './utils.js?v=1';

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
export const map = L.map('map', { center: [52.1, 5.5], zoom: 8, zoomControl: false, maxZoom: 30 });
L.control.zoom({ position: 'topright' }).addTo(map);
L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(map);

// Custom pane for the NDVI image overlay at z-index 399 — just below
// the default overlayPane (z-index 400) so vectors render on top.
map.createPane('ndviPane');
map.getPane('ndviPane').style.zIndex = 399;

const AHN_WMS_BASE = 'https://service.pdok.nl/rws/actueel-hoogtebestand-nederland/wms/v1_0';
const BODEM_WMS_BASE = 'https://service.pdok.nl/tno/bro-bodemkaart/wms/v1_0';

export const basemaps = {
  'PDOK Luchtfoto': L.tileLayer(
    'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg',
    { attribution: 'PDOK', maxZoom: 30, maxNativeZoom: 17 }
  ),
  'Esri Satelliet': L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Esri, Maxar, Earthstar Geographics', maxZoom: 30, maxNativeZoom: 19 }
  ),
  'OpenStreetMap': L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '&copy; OpenStreetMap', maxZoom: 19 }
  ),
  'AHN DTM': L.tileLayer.wms(AHN_WMS_BASE, {
    layers: 'dtm_05m', format: 'image/png', transparent: false, version: '1.1.1',
    attribution: 'PDOK / AHN', maxZoom: 30
  }),
  'AHN DSM': L.tileLayer.wms(AHN_WMS_BASE, {
    layers: 'dsm_05m', format: 'image/png', transparent: false, version: '1.1.1',
    attribution: 'PDOK / AHN', maxZoom: 30
  }),
  'BRO Bodemkaart': L.tileLayer.wms(BODEM_WMS_BASE, {
    layers: 'soilarea', format: 'image/png', transparent: false, version: '1.3.0',
    attribution: 'PDOK / BRO', maxZoom: 30
  }),
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
// AHN — legend (viewport-based elevation range)
// ==========================================

function fetchAhnLegend() {
  var bounds = map.getBounds();
  var sw = bounds.getSouthWest();
  var ne = bounds.getNorthEast();
  var size = map.getSize();
  var pt3857_sw = proj4('EPSG:4326', 'EPSG:3857', [sw.lng, sw.lat]);
  var pt3857_ne = proj4('EPSG:4326', 'EPSG:3857', [ne.lng, ne.lat]);
  var bbox = pt3857_sw[0] + ',' + pt3857_sw[1] + ',' + pt3857_ne[0] + ',' + pt3857_ne[1];
  var w = Math.round(size.x);
  var h = Math.round(size.y);
  var layerName = _activeBasemap === 'AHN DTM' ? 'dtm_05m' : 'dsm_05m';

  // Sample 9 points (3×3 grid) for elevation values
  var elevValues = [];
  var pts = [];
  for (var r = 0; r < 3; r++) {
    for (var c = 0; c < 3; c++) {
      pts.push({
        lat: sw.lat + (ne.lat - sw.lat) * (r + 0.5) / 3,
        lng: sw.lng + (ne.lng - sw.lng) * (c + 0.5) / 3
      });
    }
  }
  Promise.all(pts.map(function (pt) {
    var cpt = map.latLngToContainerPoint(L.latLng(pt.lat, pt.lng));
    var url = AHN_WMS_BASE + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo' +
      '&LAYERS=' + layerName + '&QUERY_LAYERS=' + layerName +
      '&SRS=EPSG:3857&BBOX=' + bbox +
      '&WIDTH=' + w + '&HEIGHT=' + h +
      '&X=' + Math.round(cpt.x) + '&Y=' + Math.round(cpt.y) +
      '&INFO_FORMAT=application/json&FEATURE_COUNT=1';
    return fetch(url).then(function (r) { return r.json(); }).then(function (d) {
      if (d.features && d.features[0] && d.features[0].properties) {
        // AHN WMS returns the elevation in 'value_list' property
        var props = d.features[0].properties;
        var elev = props['value_list'] || props['GRAY_INDEX'] || props['elevation'];
        if (elev !== null && elev !== undefined) elevValues.push(Number(elev));
      }
    }).catch(function () {});
  })).then(function () {
    renderAhnLegend(elevValues);
  });
}

function renderAhnLegend(values) {
  var el = document.getElementById('ahn-legend-info');
  if (!el) return;
  if (values.length === 0) {
    el.innerHTML = '<div class="wms-legend-empty">Geen hoogtegegevens in beeld</div>';
    el.style.display = '';
    return;
  }
  var min = Math.min.apply(null, values).toFixed(0);
  var max = Math.max.apply(null, values).toFixed(0);
  el.innerHTML =
    '<div class="ahn-legend-bar">' +
      '<span class="ahn-legend-label">' + min + ' m</span>' +
      '<span class="ahn-legend-gradient"></span>' +
      '<span class="ahn-legend-label">' + max + ' m</span>' +
    '</div>';
  el.style.display = '';
}

// ==========================================
// BRO BODEMKAART — legend (viewport-based)
// ==========================================

/**
 * Samples the viewport via GetFeatureInfo, collecting unique
 * normal_soilprofile_name values and their representative colours.
 */
function fetchBodemLegend() {
  var bounds = map.getBounds();
  var sw = bounds.getSouthWest();
  var ne = bounds.getNorthEast();
  var size = map.getSize();
  var pt3857_sw = proj4('EPSG:4326', 'EPSG:3857', [sw.lng, sw.lat]);
  var pt3857_ne = proj4('EPSG:4326', 'EPSG:3857', [ne.lng, ne.lat]);
  var bbox = pt3857_sw[0] + ',' + pt3857_sw[1] + ',' + pt3857_ne[0] + ',' + pt3857_ne[1];
  var w = Math.round(size.x);
  var h = Math.round(size.y);

  // 5×5 grid = 25 sample points
  var pts = [];
  for (var r = 0; r < 5; r++) {
    for (var c = 0; c < 5; c++) {
      pts.push({
        lat: sw.lat + (ne.lat - sw.lat) * (r + 0.5) / 5,
        lng: sw.lng + (ne.lng - sw.lng) * (c + 0.5) / 5
      });
    }
  }

  var seenCodes = {};
  var results = [];

  Promise.all(pts.map(function (pt) {
    var cpt = map.latLngToContainerPoint(L.latLng(pt.lat, pt.lng));
    var url = BODEM_WMS_BASE + '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo' +
      '&LAYERS=soilarea&QUERY_LAYERS=soilarea' +
      '&CRS=EPSG:3857&BBOX=' + bbox +
      '&WIDTH=' + w + '&HEIGHT=' + h +
      '&I=' + Math.round(cpt.x) + '&J=' + Math.round(cpt.y) +
      '&INFO_FORMAT=application/json&FEATURE_COUNT=1';
    return fetch(url)
      .then(function (r) { if (!r.ok) return null; return r.json(); })
      .then(function (data) {
        if (!data || !data.features || !data.features[0]) return;
        var props = data.features[0].properties || {};
        var code = props.normal_soilprofile_code || '';
        var name = props.normal_soilprofile_name || code || 'Onbekend';
        if (!code || seenCodes[code]) return;
        seenCodes[code] = true;
        results.push({ code: code, name: name, latlng: L.latLng(pt.lat, pt.lng) });
      })
      .catch(function () {});
  })).then(function () {
    return Promise.all(results.map(function (item) {
      return sampleBodemColor(item.latlng).then(function (color) {
        item.color = color || '#ccc';
      });
    }));
  }).then(function () {
    renderBodemLegend(results);
  });
}

function sampleBodemColor(latlng) {
  var pt3857 = proj4('EPSG:4326', 'EPSG:3857', [latlng.lng, latlng.lat]);
  var half = 100; // 200×200 m area for a reliable sample
  var bbox = (pt3857[0] - half) + ',' + (pt3857[1] - half) + ',' +
             (pt3857[0] + half) + ',' + (pt3857[1] + half);
  var url = BODEM_WMS_BASE + '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
    '&LAYERS=soilarea&FORMAT=image/png&TRANSPARENT=false' +
    '&CRS=EPSG:3857&STYLES=&WIDTH=10&HEIGHT=10&BBOX=' + bbox;
  return fetch(url)
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); })
    .then(function (blob) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          var canvas = document.createElement('canvas');
          canvas.width = 10; canvas.height = 10;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          var data = ctx.getImageData(0, 0, 10, 10).data;
          // Find the most common non-white colour among non-transparent pixels
          var colorCounts = {};
          var bestColor = '#ccc';
          var bestCount = 0;
          for (var i = 0; i < data.length; i += 4) {
            if (data[i+3] < 128) continue; // skip transparent
            var r = data[i], g = data[i+1], b = data[i+2];
            if (r > 250 && g > 250 && b > 250) continue; // skip white
            var key = r + ',' + g + ',' + b;
            colorCounts[key] = (colorCounts[key] || 0) + 1;
            if (colorCounts[key] > bestCount) {
              bestCount = colorCounts[key];
              bestColor = 'rgb(' + r + ',' + g + ',' + b + ')';
            }
          }
          resolve(bestColor);
        };
        img.onerror = function () { resolve('#ccc'); };
        img.src = URL.createObjectURL(blob);
      });
    })
    .catch(function () { return '#ccc'; });
}

function renderBodemLegend(entries) {
  var el = document.getElementById('bodem-legend-items');
  if (!el) return;
  if (entries.length === 0) {
    el.innerHTML = '<div class="wms-legend-empty">Geen bodemdata in beeld</div>';
    el.style.display = '';
    return;
  }
  var html = '';
  entries.sort(function (a, b) { return a.name.localeCompare(b.name); });
  entries.forEach(function (item) {
    html += '<div class="bodem-legend-item">' +
      '<span class="bodem-legend-swatch" style="background:' + item.color + '"></span>' +
      '<span class="bodem-legend-name">' + item.name + '</span>' +
    '</div>';
  });
  el.innerHTML = html;
  el.style.display = '';
}

function clearBodemLegend() {
  var el = document.getElementById('bodem-legend-items');
  if (el) { el.style.display = 'none'; }
}

// Re-fetch legends when map view changes
var _legendRefreshTimer = null;
map.on('moveend', function () {
  if (_legendRefreshTimer) clearTimeout(_legendRefreshTimer);
  _legendRefreshTimer = setTimeout(function () {
    if (_activeBasemap === 'AHN DTM' || _activeBasemap === 'AHN DSM') fetchAhnLegend();
    if (_activeBasemap === 'BRO Bodemkaart') fetchBodemLegend();
  }, 600);
});

// ==========================================
// WMS GETFEATUREINFO — click to identify
// ==========================================
// ==========================================
// LAYER GROUPS
// ==========================================
export const ahnOverlay        = L.layerGroup().addTo(map);   // kept for compat
export const bodemOverlay      = L.layerGroup().addTo(map);   // kept for compat
export const ndviOverlay       = L.layerGroup().addTo(map);
export const brpOverlay        = L.layerGroup().addTo(map);
export const selectionOverlay  = L.featureGroup().addTo(map);
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
 * Generates a CSS linear-gradient string that exactly matches the 9-stop
 * diverging colour ramp used by ndviToRGB() / ndviToColor() in ndvi.js.
 * The gradient always spans the full [stop₀, stop₈] colour range so the
 * legend colours are consistent with the map overlay regardless of the
 * current scaleMin / scaleMax labels.
 * @returns {string} CSS linear-gradient value, e.g. "linear-gradient(to right, #b40000, …)"
 */
function generateNdviGradientCss() {
  // These 9 stops MUST match ndviToRGB() in ndvi.js exactly.
  var stops = [
    '#b40000', '#e63c00', '#ff9600', '#ffdc00',
    '#b4e632', '#50c828', '#14a014', '#006e0a', '#003c00'
  ];
  return 'linear-gradient(to right, ' + stops.join(', ') + ')';
}

/**
 * Sets the min / mid / max labels below the NDVI colour ramp gradient,
 * AND synchronises the gradient colours to match ndviToRGB() exactly.
 * Called after the first NDVI render and after parcel clipping.
 * @param {number} minValue - Minimum VI value of the current display range.
 * @param {number} maxValue - Maximum VI value of the current display range.
 */
export function setLegendLabels(minValue, maxValue) {
  var mid = ((minValue + maxValue) / 2).toFixed(2);
  var markup = '<span>' + minValue.toFixed(2) + '</span><span>' + mid + '</span><span>' + maxValue.toFixed(2) + '</span>';
  var labelEl = document.getElementById('legend-labels');
  if (labelEl) labelEl.innerHTML = markup;
  // Sync the gradient colours to match ndviToRGB exactly
  var gradientCss = generateNdviGradientCss();
  var gradientEls = document.querySelectorAll('.legend-gradient');
  for (var gi = 0; gi < gradientEls.length; gi++) {
    gradientEls[gi].style.background = gradientCss;
  }
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
      '<label class="ulc-radio"><input type="radio" name="basemap" value="AHN DTM"> AHN DTM</label>' +
      '<label class="ulc-radio"><input type="radio" name="basemap" value="AHN DSM"> AHN DSM</label>' +
      '<label class="ulc-radio"><input type="radio" name="basemap" value="BRO Bodemkaart"> BRO Bodemkaart</label>' +
      '<div class="ulc-sep"></div>' +
      '<div class="ulc-section-title" data-i18n="lcLayers">Lagen</div>' +
      '<label class="ulc-check" id="ulc-layer-taakkaart" style="display:none"><input type="checkbox" data-layer="taakkaart"> <span data-i18n="lcTaskmap">\uD83D\uDCCB Taakkaart</span></label>' +
      '<label class="ulc-check" id="ulc-layer-percelen" style="display:none"><input type="checkbox" data-layer="percelen" checked> <span data-i18n="lcParcels">\uD83D\uDFE1 Percelen</span></label>' +
      '<label class="ulc-check" id="ulc-layer-selectie" style="display:none"><input type="checkbox" data-layer="selectie" checked> <span data-i18n="lcSelection">\u2705 Selectie</span></label>' +
      '<div class="ulc-ndvi-section" style="display:none">' +
        '<div class="ulc-sep"></div>' +
        '<label class="ulc-check"><input type="checkbox" data-layer="ndvi" checked> \uD83C\uDF3F <span id="vi-checkbox-label">NDVI</span></label>' +
        '<div class="legend-gradient"></div>' +
        '<div class="legend-labels" id="legend-labels"><span>-0.20</span><span>0.40</span><span>1.00</span></div>' +
      '</div>' +
      /* AHN legend — visible only when AHN DTM/AHN DSM is active */
      '<div id="ahn-legend-section" style="display:none">' +
        '<div class="ulc-sep"></div>' +
        '<div class="ulc-section-title">AHN Hoogte</div>' +
        '<div id="ahn-legend-info"></div>' +
      '</div>' +
      /* Bodemkaart legend — visible only when BRO Bodemkaart is active */
      '<div id="bodem-legend-section" style="display:none">' +
        '<div class="ulc-sep"></div>' +
        '<div class="ulc-section-title" data-i18n="lcBodemLegend">Bodemtypen in beeld</div>' +
        '<div id="bodem-legend-items"></div>' +
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
        // Show/hide AHN legend section
        var ahnSection = document.getElementById('ahn-legend-section');
        if (ahnSection) {
          if (_activeBasemap === 'AHN DTM' || _activeBasemap === 'AHN DSM') {
            ahnSection.style.display = '';
            fetchAhnLegend();
          } else {
            ahnSection.style.display = 'none';
          }
        }
        // Show/hide bodem legend section
        var bodemSection = document.getElementById('bodem-legend-section');
        if (bodemSection) {
          if (_activeBasemap === 'BRO Bodemkaart') {
            bodemSection.style.display = '';
            fetchBodemLegend();
          } else {
            bodemSection.style.display = 'none';
            clearBodemLegend();
          }
        }
      });
    });

    /**
     * Map of data-layer keys → Leaflet layer group.
     * Used by the direct change listeners below.
     */
    const layerByKey = {
      ndvi:      ndviOverlay,
      taakkaart: gridOverlay,
      percelen:  brpOverlay,
      selectie:  selectionOverlay,
    };

    /**
     * Direct change listener on every layer checkbox.
     * Avoids event-delegation pitfalls caused by Leaflet's
     * disableClickPropagation on the container element.
     */
    panel.querySelectorAll('input[data-layer]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var key = this.dataset.layer;
        var overlay = layerByKey[key];
        if (!overlay) return;
        if (this.checked) {
          map.addLayer(overlay);
          // Restore correct stacking: grid above BRP, selection on top
          if (map.hasLayer(gridOverlay)) {
            gridOverlay.eachLayer(function (l) { if (typeof l.bringToFront === 'function') l.bringToFront(); });
          }
          if (map.hasLayer(selectionOverlay)) selectionOverlay.bringToFront();
        } else {
          map.removeLayer(overlay);
        }

        // Keep "selectie" in sync when "percelen" is toggled
        if (key === 'percelen') {
          var selCb = panel.querySelector('input[data-layer="selectie"]');
          if (selCb && selCb.checked !== this.checked) {
            selCb.checked = this.checked;
            if (this.checked) {
              map.addLayer(selectionOverlay);
              selectionOverlay.bringToFront();
            }
            if (layerByKey.selectie) {
              if (this.checked) map.addLayer(layerByKey.selectie);
              else map.removeLayer(layerByKey.selectie);
            }
          }
        }
      });
    });

    return div;
  }
});

export const layerControlInstance = new LayerControlClass().addTo(map);

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
  // Bepaal de leesbare label voor de geselecteerde index
  var viDef = VEGETATION_INDICES.find(function (v) { return v.id === state.selectedVI; });
  var label = viDef ? viDef.label : (state.selectedVI || 'NDVI');

  // ➜ Checkbox-label in het lagenpaneel
  var cbox = document.getElementById('vi-checkbox-label');
  if (cbox) cbox.textContent = label;

  // Stap-3 progress label (stappenbalk bovenaan)
  var badge = document.querySelector('[data-i18n="step3label"]');
  if (badge) badge.textContent = label;

  // Werk de histogram-titel bij (stap 4)
  var histTitle = document.getElementById('histogram-title');
  if (histTitle) histTitle.textContent = label + ' verdeling';

  // Update VI-bereik label in bestand-info paneel
  var rangeLabel = document.getElementById('vi-range-label');
  if (rangeLabel) rangeLabel.textContent = label + ' bereik:';

  // Sync the gradient to match ndviToRGB exactly (replaces the CSS fallback)
  var gradientCss = generateNdviGradientCss();
  var gradientEls = document.querySelectorAll('.legend-gradient');
  for (var gi = 0; gi < gradientEls.length; gi++) {
    gradientEls[gi].style.background = gradientCss;
  }

  // Update layer visibility (toon/verberg lagen op basis van status)
  updateLayerVisibility();
}

/**
 * Toont/verbergt laag-checkboxes in het lagenpaneel op basis van
 * de applicatiestatus — alleen zichtbaar als de laag daadwerkelijk
 * gegenereerd of geladen is in de kaart.
 */
export function updateLayerVisibility() {
  // NDVI-sectie: toon wanneer NDVI is gerenderd
  var ndviSection = document.querySelector('.ulc-ndvi-section');
  if (ndviSection) {
    ndviSection.style.display = state.ndviLayer ? '' : 'none';
  }

  // BRP percelen: toon wanneer perceeldata geladen is OF er handmatige velden zijn
  var percelenLabel = document.getElementById('ulc-layer-percelen');
  if (percelenLabel) {
    percelenLabel.style.display = (state.brpGeoJSON || state.manualFields.length > 0) ? '' : 'none';
  }

  // Selectie: toon wanneer er percelen geselecteerd zijn
  var selectieLabel = document.getElementById('ulc-layer-selectie');
  if (selectieLabel) {
    selectieLabel.style.display = (state.selectedParcels && state.selectedParcels.length > 0) ? '' : 'none';
  }

  // Taakkaart: toon wanneer het taakkaart-grid gegenereerd is
  var taakkaartLabel = document.getElementById('ulc-layer-taakkaart');
  if (taakkaartLabel) {
    taakkaartLabel.style.display = state.gridLayer ? '' : 'none';
  }
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


