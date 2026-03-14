/* ===================================================
   Taakkaart Generator — Application Logic
   =================================================== */
(function () {
  'use strict';

  // ==========================================
  // CONFIGURATION
  // ==========================================
  const BRP_WFS_URL = 'https://service.pdok.nl/rvo/gewaspercelen/wfs/v1_0';
  const MIN_ZOOM_BRP = 14;

  const DEFAULT_CLASSES = [
    { name: 'Zeer laag', min: -1.0, max: 0.25, rate: 150, color: '#d32f2f' },
    { name: 'Laag',      min: 0.25, max: 0.40, rate: 120, color: '#f57c00' },
    { name: 'Midden',    min: 0.40, max: 0.55, rate: 90,  color: '#fdd835' },
    { name: 'Hoog',      min: 0.55, max: 0.70, rate: 60,  color: '#66bb6a' },
    { name: 'Zeer hoog', min: 0.70, max: 1.00, rate: 30,  color: '#2e7d32' },
  ];

  // Proj4 definitions
  proj4.defs('EPSG:28992', '+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +units=m +no_defs');
  proj4.defs('EPSG:32631', '+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs');
  proj4.defs('EPSG:32632', '+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs');

  // ==========================================
  // STATE
  // ==========================================
  const state = {
    georaster: null,
    ndviLayer: null,
    geotiffEPSG: null,
    blobUrl: null,
    tiff: null,
    tiffImage: null,
    bandMetas: [],
    isRGBProxy: false,  // true when the TIF is an RGB(A) colorized NDVI export
    brpLayer: null,
    brpGeoJSON: null,
    selectedParcels: [],
    selectedParcelsLayer: null,
    maskLayer: null,
    gridLayer: null,
    taskMapFC: null,
    gridSize: 10,
    gridAngle: 0,       // rotation angle in degrees (0 = north-south rows)
    parcelHistoryCache: {}, // keyed by centroid string
    bandRed: null,
    bandNIR: null,
    classes: JSON.parse(JSON.stringify(DEFAULT_CLASSES)),
    unit: 'kg/ha',
    currentStep: 1,
    isPreCalc: false,
    brpLoading: false,
  };

  // ==========================================
  // DOM REFERENCES
  // ==========================================
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const geotiffInput = $('#geotiff-input');
  const fileDrop = $('#file-drop');
  const fileInfo = $('#file-info');
  const redBandSel = $('#red-band');
  const nirBandSel = $('#nir-band');
  const computeBtn = $('#compute-ndvi-btn');
  const stretchCheck = $('#stretch-ndvi');
  const gridSlider = $('#grid-size');
  const gridValue = $('#grid-size-value');
  const gridAngleSlider = $('#grid-angle');
  const gridAngleValue = $('#grid-angle-value');
  const autoAngleBtn = $('#auto-angle-btn');
  const autoAngleHint = $('#auto-angle-hint');
  const unitSelect = $('#unit-select');
  const classesContainer = $('#classes-container');
  const addClassBtn = $('#add-class-btn');
  const generateBtn = $('#generate-btn');
  const exportShpBtn = $('#export-shp-btn');
  const exportGeoBtn = $('#export-geojson-btn');
  const exportNameInput = $('#export-name');
  const loadingOverlay = $('#loading-overlay');
  const loadingText = $('#loading-text');
  const toastEl = $('#toast');

  // ==========================================
  // MAP SETUP
  // ==========================================
  const map = L.map('map', { center: [52.1, 5.5], zoom: 8, zoomControl: false });
  L.control.zoom({ position: 'topright' }).addTo(map);

  const basemaps = {
    'PDOK Luchtfoto': L.tileLayer(
      'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg',
      { attribution: 'PDOK', maxZoom: 19 }
    ),
    'OpenStreetMap': L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '&copy; OpenStreetMap', maxZoom: 19 }
    ),
  };
  basemaps['PDOK Luchtfoto'].addTo(map);

  const ndviOverlay = L.layerGroup().addTo(map);
  const selectionOverlay = L.layerGroup().addTo(map);
  const brpOverlay = L.layerGroup().addTo(map);
  const gridOverlay = L.layerGroup().addTo(map);

  L.control.layers(basemaps, {
    'NDVI': ndviOverlay,
    'BRP Percelen': brpOverlay,
    'Selectie': selectionOverlay,
    'Taakkaart': gridOverlay,
  }, { position: 'topright', collapsed: true }).addTo(map);

  // NDVI Legend — labels updated dynamically when NDVI is displayed
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'ndvi-legend');
    div.innerHTML =
      '<h4>NDVI</h4>' +
      '<div class="legend-gradient"></div>' +
      '<div class="legend-labels" id="legend-labels"><span>laag</span><span></span><span>hoog</span></div>' +
      '<div id="legend-parcel" style="display:none">' +
        '<div class="legend-parcel-sep"></div>' +
        '<div id="legend-parcel-content"></div>' +
      '</div>';
    return div;
  };

  function updateLegendCrop(feature, byYear) {
    var container = document.getElementById('legend-parcel');
    var content = document.getElementById('legend-parcel-content');
    if (!container || !content) return;
    var props = feature.properties || {};
    var currentCrop = props.gewas || props.GWS_GEWAS || props.gewasgroep || '—';
    var currentYear = props.registratiejaar || props.RegistratieJaar || '';
    var html = '<div class="lp-current"><span class="lp-crop">' + escapeHtml(currentCrop) + '</span>';
    if (currentYear) html += ' <span class="lp-year">' + escapeHtml(currentYear) + '</span>';
    html += '</div>';
    if (byYear) {
      var years = Object.keys(byYear).sort(function (a, b) { return Number(b) - Number(a); });
      var histRows = years.filter(function (y) { return String(y) !== String(currentYear); });
      if (histRows.length > 0) {
        html += '<table class="lp-table">';
        histRows.forEach(function (y) {
          html += '<tr><td class="lp-yr">' + escapeHtml(y) + '</td><td class="lp-cn">' + escapeHtml(byYear[y]) + '</td></tr>';
        });
        html += '</table>';
      }
    }
    content.innerHTML = html;
    container.style.display = '';
  }

  function clearLegendCrop() {
    var container = document.getElementById('legend-parcel');
    if (container) container.style.display = 'none';
  }

  // ==========================================
  // UTILITIES
  // ==========================================

  /**
   * Escapes HTML special characters to prevent XSS when inserting
   * external data (BRP crop names, TIFF band names, user input) into
   * innerHTML strings.
   * @param {*} s - value to sanitise (coerced to string)
   * @returns {string} HTML-safe string
   */
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showLoading(text) {
    loadingText.textContent = text || 'Laden...';
    loadingOverlay.classList.remove('hidden');
  }

  function hideLoading() {
    loadingOverlay.classList.add('hidden');
  }

  let toastTimer = null;
  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.className = 'toast visible' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = 'toast hidden'; }, 4000);
  }

  function ndviToColor(ndvi) {
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
      if (ndvi >= stops[i].v && ndvi <= stops[i + 1].v) {
        lo = stops[i]; hi = stops[i + 1]; break;
      }
    }
    const t = hi.v === lo.v ? 0 : (ndvi - lo.v) / (hi.v - lo.v);
    const r = Math.round(lo.r + t * (hi.r - lo.r));
    const g = Math.round(lo.g + t * (hi.g - lo.g));
    const b = Math.round(lo.b + t * (hi.b - lo.b));
    return 'rgba(' + r + ',' + g + ',' + b + ',0.85)';
  }

  function ndviToRGB(ndvi, scaleMin, scaleMax) {
    if (ndvi === null || ndvi === undefined || isNaN(ndvi)) return null;
    // Normalize to 0..1 within the given scale range
    scaleMin = (scaleMin !== undefined) ? scaleMin : -0.2;
    scaleMax = (scaleMax !== undefined) ? scaleMax : 1.0;
    var t = (ndvi - scaleMin) / (scaleMax - scaleMin);
    t = Math.max(0, Math.min(1, t));
    // 9-stop high-contrast ramp: vivid red → orange → yellow → lime → green → deep green
    var stops = [
      { r: 180, g:   0, b:   0 },  // deep red   (very low / bare soil)
      { r: 230, g:  60, b:   0 },  // orange-red
      { r: 255, g: 150, b:   0 },  // orange
      { r: 255, g: 220, b:   0 },  // bright yellow
      { r: 180, g: 230, b:  50 },  // yellow-green
      { r:  80, g: 200, b:  40 },  // lime green
      { r:  20, g: 160, b:  20 },  // mid green
      { r:   0, g: 110, b:  10 },  // dark green
      { r:   0, g:  60, b:   0 },  // very dark green (dense canopy)
    ];
    var pos = t * (stops.length - 1);
    var lo = Math.floor(pos), hi = Math.min(lo + 1, stops.length - 1);
    var f = pos - lo;
    return {
      r: Math.round(stops[lo].r + f * (stops[hi].r - stops[lo].r)),
      g: Math.round(stops[lo].g + f * (stops[hi].g - stops[lo].g)),
      b: Math.round(stops[lo].b + f * (stops[hi].b - stops[lo].b)),
    };
  }

  function convertCoords(coords, from, to) {
    if (typeof coords[0] === 'number') {
      const c = proj4(from, to, [coords[0], coords[1]]);
      return coords.length > 2 ? [c[0], c[1], coords[2]] : c;
    }
    return coords.map(function (c) { return convertCoords(c, from, to); });
  }

  function convertGeoJSON(gj, from, to) {
    const copy = JSON.parse(JSON.stringify(gj));
    (copy.features || []).forEach(function (f) {
      f.geometry.coordinates = convertCoords(f.geometry.coordinates, from, to);
    });
    return copy;
  }

  // Auto-register proj4 definitions for common EPSG codes
  function ensureEPSG(code) {
    if (!code) return null;
    var key = 'EPSG:' + code;
    try { if (proj4.defs(key)) return key; } catch (e) {}
    if (code >= 32601 && code <= 32660) {
      var zone = code - 32600;
      proj4.defs(key, '+proj=utm +zone=' + zone + ' +datum=WGS84 +units=m +no_defs');
      return key;
    }
    if (code >= 32701 && code <= 32760) {
      var zone = code - 32700;
      proj4.defs(key, '+proj=utm +zone=' + zone + ' +south +datum=WGS84 +units=m +no_defs');
      return key;
    }
    if (code === 28992) return 'EPSG:28992'; // already defined
    console.warn('Onbekende EPSG: ' + code + ', behandeld als WGS84');
    return null;
  }

  // ==========================================
  // STEP MANAGEMENT
  // ==========================================
  function activateStep(n) {
    state.currentStep = n;
    $$('.step').forEach(function (el) {
      const s = parseInt(el.dataset.step);
      el.classList.remove('active', 'completed', 'disabled');
      if (s < n) el.classList.add('completed');
      else if (s === n) el.classList.add('active');
      else el.classList.add('disabled');
    });
  }

  function openStep(n) {
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
    // On mobile the sidebar is a bottom-sheet; scroll the opened step into
    // view so the user doesn't need to manually scroll down to see it.
    if (window.innerWidth <= 768) {
      setTimeout(function () {
        stepEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 60);
    }
  }

  // Step header clicks
  $$('.step-header').forEach(function (hdr) {
    hdr.addEventListener('click', function () {
      const n = parseInt(hdr.dataset.toggle);
      if (n <= state.currentStep) openStep(n);
    });
  });

  // ==========================================
  // STEP 1: FILE UPLOAD
  // ==========================================
  geotiffInput.addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    if (file) handleFileUpload(file);
  });

  // Drag & drop
  fileDrop.addEventListener('dragover', function (e) {
    e.preventDefault();
    fileDrop.classList.add('drag-over');
  });
  fileDrop.addEventListener('dragleave', function () {
    fileDrop.classList.remove('drag-over');
  });
  fileDrop.addEventListener('drop', function (e) {
    e.preventDefault();
    fileDrop.classList.remove('drag-over');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  });

  async function handleFileUpload(file) {
    if (state.blobUrl) { URL.revokeObjectURL(state.blobUrl); state.blobUrl = null; }

    showLoading('GeoTIFF metadata lezen…');
    try {
      var GTIFF = window.GeoTIFF;
      if (!GTIFF) throw new Error('geotiff.js niet geladen — herlaad de pagina.');

      // Blob URL = lazy byte-range reading; very fast even for large files
      var blobUrl = URL.createObjectURL(file);
      state.blobUrl = blobUrl;

      // Step 1: read only file headers (few KB, near-instant)
      var tiff = await GTIFF.fromUrl(blobUrl);
      var imageCount = await tiff.getImageCount();
      var image = await tiff.getImage(0);

      var nBands    = image.getSamplesPerPixel();
      var bbox      = image.getBoundingBox();   // [xmin, ymin, xmax, ymax] native CRS
      var fullW     = image.getWidth();
      var fullH     = image.getHeight();
      // Detect alpha channel(s) so they are excluded from band selectors
      var fd = image.fileDirectory || {};
      var extraSamples = fd.ExtraSamples;
      if (!Array.isArray(extraSamples)) extraSamples = (extraSamples != null) ? [extraSamples] : [];
      var nAlpha = extraSamples.filter(function(s) { return s === 1 || s === 2; }).length;
      var nDataBands = Math.max(1, nBands - nAlpha);
      var noDataVal = image.getGDALNoData();
      noDataVal = (noDataVal !== null && noDataVal !== undefined) ? parseFloat(noDataVal) : null;
      if (noDataVal !== null && isNaN(noDataVal)) noDataVal = null; // 'nan' GDAL tag → treat as unset

      // Read per-band GDAL metadata (wavelength + name) — used for smart band auto-detection
      var bandMetas = [];
      for (var bi = 0; bi < nBands; bi++) {
        var bmeta = image.getGDALMetadata(bi) || {};
        // normalize keys to lowercase for robustness
        var bmetaLC = {};
        for (var k in bmeta) if (bmeta.hasOwnProperty(k)) bmetaLC[k.toLowerCase()] = bmeta[k];
        var wl = parseFloat(bmetaLC.wavelength || bmetaLC.central_wavelength || '0') || 0;
        var bname = (bmetaLC.band_name || bmetaLC.bandname || bmetaLC.name || '').trim();
        bandMetas.push({ wavelength: wl, name: bname, sampleFormat: image.getSampleFormat(bi), bitsPerSample: image.getBitsPerSample(bi) });
      }
      state.bandMetas = bandMetas;

      // Smart auto-detect Red (620-700nm) and NIR (780-960nm) by wavelength or name
      // ODM names for DJI Mavic Multispectral: 'Red','Nir','Rededge','Blue','Green'
      // Band order when sorted by filename: B(450), G(560), NIR(840), R(650), RE(730)
      function pickBand(wlLow, wlHigh, nameRe, fallbacksInOrder) {
        // 1. wavelength match (strict)
        for (var i = 0; i < nDataBands; i++) if (bandMetas[i].wavelength >= wlLow && bandMetas[i].wavelength <= wlHigh) return i;
        // 1b. wavelength match (relaxed ±30nm)
        for (var i = 0; i < nDataBands; i++) if (bandMetas[i].wavelength >= wlLow - 30 && bandMetas[i].wavelength <= wlHigh + 30) return i;
        // 2. name match (case-insensitive)
        for (var i = 0; i < nDataBands; i++) if (bandMetas[i].name && nameRe.test(bandMetas[i].name)) return i;
        // 3. value-range heuristic: NIR has highest reflectance, Red is lower
        return fallbacksInOrder[0] !== undefined ? fallbacksInOrder[0] : 0;
      }

      // Detect whether this is an RGB display image (e.g. DJI Plant Health export)
      // PhotometricInterpretation=2 means RGB, no spectral wavelength/name metadata
      var photoInterp = fd.PhotometricInterpretation || 0;
      var hasSpectralMeta = bandMetas.some(function (m) { return m.wavelength > 0 || m.name; });
      var isRGBProxy = (photoInterp === 2) && (nDataBands >= 3) && !hasSpectralMeta;
      state.isRGBProxy = isRGBProxy;

      var geoKeys   = image.geoKeys || {};
      var epsgCode  = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey || null;
      var epsg      = ensureEPSG(epsgCode);

      state.tiff        = tiff;
      state.tiffImage   = image;
      state.geotiffEPSG = epsg;

      // Step 2: pick smallest overview >= 256px wide (much faster read for large files)
      var readImage = image;
      var MAX_DIM = 1024;
      if (imageCount > 1) {
        for (var oi = imageCount - 1; oi >= 1; oi--) {
          var ov = await tiff.getImage(oi);
          if (ov.getWidth() >= 256) { readImage = ov; break; }
        }
      }
      var rw = readImage.getWidth(), rh = readImage.getHeight();
      var scale = Math.max(rw / MAX_DIM, rh / MAX_DIM, 1);
      var tw = Math.ceil(rw / scale), th = Math.ceil(rh / scale);

      loadingText.textContent = 'Banden laden (' + tw + '\xd7' + th + ' px)\u2026';

      // Step 3: read rasters at target resolution
      // For COG (WebODM default), this only fetches the overview tiles — very fast
      var rasters = await readImage.readRasters({
        interleave: false,
        width: tw, height: th,
        resampleMethod: 'bilinear'
      });

      // Step 4: build georaster-compatible object
      // For float32 bands (sampleFormat=3), noData=0 from ODM — use epsilon check to avoid
      // excluding valid low-reflectance pixels; for uint16 use strict equality.
      var isFloat = bandMetas.length > 0 && bandMetas[0].sampleFormat === 3;
      var noDataEps = (isFloat && noDataVal !== null) ? 1e-6 : 0;
      function isNoData(v) {
        if (v === null || isNaN(v)) return true;
        if (noDataVal === null) return false;
        return noDataEps > 0 ? Math.abs(v - noDataVal) < noDataEps : v === noDataVal;
      }

      var values = [], mins = [], maxs = [];
      for (var b = 0; b < nBands; b++) {
        var flat = rasters[b];
        var rows = [];
        var bMin = Infinity, bMax = -Infinity;
        for (var r = 0; r < th; r++) {
          var row = Array.from(flat.subarray ? flat.subarray(r * tw, (r + 1) * tw) : flat.slice(r * tw, (r + 1) * tw));
          rows.push(row);
          for (var c = 0; c < tw; c++) {
            var v = row[c];
            if (!isNoData(v)) {
              if (v < bMin) bMin = v;
              if (v > bMax) bMax = v;
            }
          }
        }
        values.push(rows);
        mins.push(bMin === Infinity  ? 0 : bMin);
        maxs.push(bMax === -Infinity ? 1 : bMax);
      }

      state.georaster = {
        width: tw, height: th,
        numberOfRasters: nBands,
        xmin: bbox[0], ymin: bbox[1], xmax: bbox[2], ymax: bbox[3],
        pixelWidth:  (bbox[2] - bbox[0]) / tw,
        pixelHeight: (bbox[3] - bbox[1]) / th,
        noDataValue: noDataVal,
        projection:  epsgCode,   // numeric EPSG code
        values: values,
        mins: mins, maxs: maxs,
      };

      // Show file info
      $('#info-filename').textContent = file.name;
      $('#info-dims').textContent = fullW + ' \xd7 ' + fullH + ' px';
      $('#info-bands').textContent = nDataBands + (nAlpha > 0 ? ' (+ ' + nAlpha + ' alpha)' : '');
      fileInfo.classList.remove('hidden');

      if (nDataBands === 1) {
        state.isPreCalc = true;
        state.isRGBProxy = false;
        $('#info-mode').textContent = 'Pre-berekende NDVI (1 band)';
        hideLoading();
        toast('Pre-berekende NDVI gedetecteerd.');
        displayNDVI();
        zoomToGeoTIFF();
        activateStep(3);
        startBRPLoading();
      } else if (isRGBProxy) {
        // RGB colorized export (DJI Plant Health / Terra) — display as-is
        // Proxy NDVI = (G - R) / (G + R) from the rendered colors
        state.isPreCalc = false;
        state.bandRed = 0; // R channel
        state.bandNIR = 1; // G channel (used only for proxy NDVI in sampleNDVI)
        var ovNote2 = tw < fullW ? ' (geladen als ' + tw + '\xd7' + th + ' px)' : '';
        $('#info-mode').textContent = 'RGB kleurenkaart (Plant Health export)' + ovNote2;
        $('#band-info-row').classList.add('hidden');
        // Populate band selectors so user can override RGB proxy detection
        populateBandSelectors(nDataBands);
        $('#band-desc').textContent = 'RGB kleurenkaart gedetecteerd. Klik hieronder op \u201cBereken NDVI\u201d om handmatig Red en NIR banden te kiezen als de detectie niet klopt.';
        hideLoading();
        toast('RGB Plant Health kaart gedetecteerd — wordt direct weergegeven.');
        displayNDVI();
        zoomToGeoTIFF();
        activateStep(3);
        startBRPLoading();
      } else {
        state.isPreCalc = false;
        // Use wavelength-based detection first; fall back to position-based defaults
        // Fallback positions for 5-band alphabetical ODM order: B(0),G(1),NIR(2),R(3),RE(4)
        state.bandRed = pickBand(620, 700, /^red$/i,
          [nDataBands >= 5 ? 3 : (nDataBands >= 4 ? 2 : 0)]);
        state.bandNIR = pickBand(780, 960, /nir|near.?ir|near.?infra/i,
          [nDataBands >= 5 ? 2 : (nDataBands >= 4 ? 3 : nDataBands - 1)]);
        // If wavelength/name were both absent → use value-range heuristic:
        // NIR band typically has the highest mean reflectance
        var hasWlOrName = bandMetas.some(function(m) { return m.wavelength > 0 || m.name; });
        if (!hasWlOrName && nDataBands >= 2) {
          var bandMeans = [];
          for (var i = 0; i < nDataBands; i++) {
            var s = 0, cnt = 0;
            var bvals = values[i];
            for (var rr = 0; rr < th; rr += 4)
              for (var cc = 0; cc < tw; cc += 4) {
                var vv = bvals[rr][cc];
                if (!isNaN(vv) && vv !== noDataVal && vv !== null) { s += vv; cnt++; }
              }
            bandMeans.push(cnt > 0 ? s / cnt : 0);
          }
          // NIR = band with highest mean; Red = band with second highest that is < NIR mean
          var sorted = bandMeans.map(function(v,i){return{v:v,i:i};}).sort(function(a,b){return b.v-a.v;});
          state.bandNIR = sorted[0].i;
          // Red: typically 60-70% of NIR mean in healthy crops; pick band closest to 65% of NIR
          var nirMean = sorted[0].v;
          var best = -1, bestDiff = Infinity;
          for (var i = 0; i < nDataBands; i++) {
            if (i === state.bandNIR) continue;
            var diff = Math.abs(bandMeans[i] - nirMean * 0.65);
            if (diff < bestDiff) { bestDiff = diff; best = i; }
          }
          state.bandRed = best >= 0 ? best : sorted[1].i;
          console.log('[Auto heuristic] band means:', bandMeans.map(function(v,i){return 'B'+(i+1)+':'+v.toFixed(4);}).join(' '));
        }
        if (state.bandRed === state.bandNIR) state.bandNIR = state.bandRed === nDataBands-1 ? nDataBands-2 : nDataBands-1;

        // Log band diagnostics to console
        console.log('[Banden]', bandMetas.map(function(m, i) {
          return 'B' + (i+1) + ':' + (m.name || '?') + (m.wavelength ? '@' + m.wavelength + 'nm' : '') +
            ' ' + m.bitsPerSample + 'bit sf=' + m.sampleFormat +
            ' min=' + (state.georaster.mins[i] != null ? state.georaster.mins[i].toFixed(4) : '?') +
            ' max=' + (state.georaster.maxs[i] != null ? state.georaster.maxs[i].toFixed(4) : '?');
        }).join(' | '));
        console.log('[Auto-detect] Red=B' + (state.bandRed+1) + ' NIR=B' + (state.bandNIR+1));

        // Show band-info table in UI
        var tbl = $('#band-info-table');
        if (tbl) {
          tbl.innerHTML = '<tr style="color:#aaa"><th>B</th><th>Naam</th><th>nm</th><th>Min</th><th>Max</th></tr>' +
            bandMetas.slice(0, nDataBands).map(function(m, i) {
              var isR = i === state.bandRed, isN = i === state.bandNIR;
              var flag = isR ? ' 🔴R' : (isN ? ' 🟢N' : '');
              return '<tr style="' + (isR||isN?'font-weight:bold':'') + '">' +
                '<td>B' + (i+1) + flag + '</td>' +
                '<td>' + escapeHtml(m.name || '-') + '</td>' +
                '<td>' + escapeHtml(m.wavelength || '-') + '</td>' +
                '<td>' + (state.georaster.mins[i] != null ? state.georaster.mins[i].toFixed(3) : '-') + '</td>' +
                '<td>' + (state.georaster.maxs[i] != null ? state.georaster.maxs[i].toFixed(3) : '-') + '</td>' +
                '</tr>';
            }).join('');
          $('#band-info-row').classList.remove('hidden');
        }

        var ovNote = tw < fullW ? ' (geladen als ' + tw + '\xd7' + th + ' px)' : '';
        $('#info-mode').textContent = nDataBands + ' banden' + ovNote;
        populateBandSelectors(nDataBands);
        $('#band-desc').textContent = 'Selecteer de Red en NIR banden voor NDVI-berekening.';
        hideLoading();
        toast('GeoTIFF geladen. Controleer de banden.');
        activateStep(2);
      }
    } catch (err) {
      hideLoading();
      console.error(err);
      toast('Fout bij laden: ' + err.message, true);
    }
  }

  // ==========================================
  // STEP 2: BAND SELECTION
  // ==========================================
  /**
   * Populates the Red-band and NIR-band <select> elements.
   * Label text uses: wavelength + name metadata (if present), ODM band
   * naming conventions (B/G/NIR/R/RE for 5-band, etc.), or a generic
   * Band N fallback.  Pre-selects the auto-detected band indices.
   * @param {number} n - number of data bands (excludes alpha)
   */
  function populateBandSelectors(n) {
    redBandSel.innerHTML = '';
    nirBandSel.innerHTML = '';
    var metas = state.bandMetas || [];
    // ODM alphabetical order fallback names for common configurations
    var odmNames5 = ['Blue (B)', 'Green (G)', 'NIR', 'Red (R)', 'RedEdge (RE)'];
    var odmNames4 = ['Blue (B)', 'Green (G)', 'Red (R)', 'NIR'];
    var odmNames3 = ['Red (R)', 'Green (G)', 'Blue (B)'];
    // RGB(A) images: use actual RGB channel order instead of ODM multispectral guess
    var rgbNames3 = ['Red (R)', 'Green (G)', 'Blue (B)'];
    var rgbNames4 = ['Red (R)', 'Green (G)', 'Blue (B)', 'Alpha'];
    for (var i = 0; i < n; i++) {
      var m = metas[i] || {};
      var gr = state.georaster;
      var lbl;
      if (m.name && m.wavelength) {
        lbl = 'B' + (i + 1) + ': ' + m.name + ' (' + m.wavelength + ' nm)';
      } else if (m.name) {
        lbl = 'B' + (i + 1) + ': ' + m.name;
      } else if (state.isRGBProxy) {
        // RGB(A) image — label channels as R, G, B (not ODM multispectral order)
        var rgbName = n >= 4 ? (rgbNames4[i] || 'Band ' + (i + 1))
          : n === 3 ? (rgbNames3[i] || 'Band ' + (i + 1))
          : 'Band ' + (i + 1);
        lbl = 'B' + (i + 1) + ': ' + rgbName + (gr ? '  [' + gr.mins[i].toFixed(2) + '\u2013' + gr.maxs[i].toFixed(2) + ']' : '');
      } else {
        // Use ODM naming convention based on band count
        var guessName = n === 5 ? odmNames5[i]
          : n === 4 ? odmNames4[i]
          : n === 3 ? odmNames3[i]
          : 'Band ' + (i + 1);
        lbl = 'B' + (i + 1) + ': ' + guessName + (gr ? '  [' + gr.mins[i].toFixed(2) + '\u2013' + gr.maxs[i].toFixed(2) + ']' : '');
      }
      redBandSel.add(new Option(lbl, i));
      nirBandSel.add(new Option(lbl, i));
    }
    if (state.bandRed !== null) redBandSel.value = state.bandRed;
    if (state.bandNIR !== null) nirBandSel.value = state.bandNIR;
  }

  computeBtn.addEventListener('click', function () {
    state.bandRed = parseInt(redBandSel.value);
    state.bandNIR = parseInt(nirBandSel.value);
    // Keep isRGBProxy intact — for RGB proxy files the display should stay
    // as-is (raw RGB image) while sampleNDVI uses the selected bands.
    state.isPreCalc = false;
    if (state.bandRed === state.bandNIR) {
      toast('Red en NIR mogen niet dezelfde band zijn.', true);
      return;
    }
    showLoading('NDVI berekenen...');
    setTimeout(function () {
      displayNDVI();
      zoomToGeoTIFF();
      hideLoading();
      toast('NDVI berekend en weergegeven.');
      activateStep(3);
      startBRPLoading();
    }, 50);
  });

  // ==========================================
  // STEP 3: NDVI DISPLAY
  // ==========================================
  function getGeoBounds() {
    var gr = state.georaster;
    var epsg = state.geotiffEPSG;
    if (!epsg || epsg === 'EPSG:4326') {
      return L.latLngBounds([gr.ymin, gr.xmin], [gr.ymax, gr.xmax]);
    }
    try {
      var sw = proj4(epsg, 'EPSG:4326', [gr.xmin, gr.ymin]);
      var ne = proj4(epsg, 'EPSG:4326', [gr.xmax, gr.ymax]);
      return L.latLngBounds([sw[1], sw[0]], [ne[1], ne[0]]);
    } catch (e) {
      return L.latLngBounds([gr.ymin, gr.xmin], [gr.ymax, gr.xmax]);
    }
  }

  /**
   * Renders the current NDVI (or proxy / RGB) raster to a canvas and adds it
   * as a Leaflet ImageOverlay.  Three modes:
   *   - isRGBProxy: paint the raw RGB pixels with slight transparency
   *   - isPreCalc:  values[0] is already the NDVI float
   *   - normal:     NDVI = (NIR − Red) / (NIR + Red) per pixel
   * Uses a two-pass approach: first pass collects the NDVI range for
   * adaptive colour scaling; second pass maps each pixel through ndviToRGB().
   */
  function displayNDVI() {
    ndviOverlay.clearLayers();

    var gr = state.georaster;

    // ---- RGB proxy mode: display the original RGB image as-is ----
    if (state.isRGBProxy) {
      var canvas = document.createElement('canvas');
      canvas.width = gr.width; canvas.height = gr.height;
      var ctx = canvas.getContext('2d');
      var imgData = ctx.createImageData(gr.width, gr.height);
      var px = imgData.data;
      var hasAlpha = gr.numberOfRasters >= 4;
      for (var row = 0; row < gr.height; row++) {
        for (var col = 0; col < gr.width; col++) {
          var idx = (row * gr.width + col) << 2;
          var rv = gr.values[0][row][col];
          var gv = gr.values[1][row][col];
          var bv = gr.values[2][row][col];
          var av = hasAlpha ? gr.values[3][row][col] : 255;
          if (av === 0) continue; // transparent pixel
          px[idx]     = rv;
          px[idx + 1] = gv;
          px[idx + 2] = bv;
          px[idx + 3] = Math.round(av * 0.85); // slight transparency
        }
      }
      ctx.putImageData(imgData, 0, 0);
      state.ndviLayer = L.imageOverlay(canvas.toDataURL('image/png'), getGeoBounds(), { opacity: 1 });
      ndviOverlay.addLayer(state.ndviLayer);
      legend.addTo(map);
      return;
    }

    var isP = state.isPreCalc;
    var bR = state.bandRed;
    var bN = state.bandNIR;
    var noData = gr.noDataValue;
    var isFloat = state.bandMetas.length > 0 && state.bandMetas[0].sampleFormat === 3;
    var noDataEps = (isFloat && noData !== null) ? 1e-6 : 0;
    function nd(v) { return v === null || isNaN(v) || (noData !== null && (noDataEps > 0 ? Math.abs(v - noData) < noDataEps : v === noData)); }
    var stretch = stretchCheck && stretchCheck.checked;
    // Detect alpha channel so transparent background pixels are skipped
    var hasAlpha = gr.numberOfRasters >= 4 && state.bandMetas.length > 0 &&
      (gr.numberOfRasters > Math.max(bR, bN) + 1);
    var alphaBand = hasAlpha ? gr.numberOfRasters - 1 : -1;

    // Render NDVI directly to a canvas and use L.imageOverlay
    var canvas = document.createElement('canvas');
    canvas.width = gr.width;
    canvas.height = gr.height;
    var ctx = canvas.getContext('2d');
    var imgData = ctx.createImageData(gr.width, gr.height);
    var px = imgData.data;
    var ndviMin = Infinity, ndviMax = -Infinity, ndviCount = 0;

    // First pass: collect all valid NDVI values for range detection
    var ndviGrid = new Float32Array(gr.width * gr.height);
    ndviGrid.fill(NaN);
    for (var row = 0; row < gr.height; row++) {
      for (var col = 0; col < gr.width; col++) {
        // Skip transparent pixels (alpha = 0)
        if (alphaBand >= 0 && gr.values[alphaBand][row][col] === 0) continue;
        var ndvi;
        if (isP) {
          var v = gr.values[0][row][col];
          if (nd(v)) continue;
          ndvi = v;
        } else {
          var rv = gr.values[bR][row][col];
          var nv = gr.values[bN][row][col];
          if (nd(rv) || nd(nv)) continue;
          if ((rv + nv) === 0) continue;
          ndvi = (nv - rv) / (nv + rv);
        }
        ndviGrid[row * gr.width + col] = ndvi;
        if (ndvi < ndviMin) ndviMin = ndvi;
        if (ndvi > ndviMax) ndviMax = ndvi;
        ndviCount++;
      }
    }

    // Determine color scale range
    var scaleMin = -0.2, scaleMax = 1.0;
    if (stretch && ndviCount > 0) {
      // Clamp to -1..1, add 5% margin so edges aren't clipped
      var margin = Math.max(0.02, (ndviMax - ndviMin) * 0.05);
      scaleMin = Math.max(-1, ndviMin - margin);
      scaleMax = Math.min(1, ndviMax + margin);
      if (scaleMax <= scaleMin) scaleMax = scaleMin + 0.01;
    }

    // Second pass: render
    for (var row = 0; row < gr.height; row++) {
      for (var col = 0; col < gr.width; col++) {
        var ndvi = ndviGrid[row * gr.width + col];
        if (isNaN(ndvi)) continue;
        var rgb = ndviToRGB(ndvi, scaleMin, scaleMax);
        if (!rgb) continue;
        var idx = (row * gr.width + col) << 2;
        px[idx]     = rgb.r;
        px[idx + 1] = rgb.g;
        px[idx + 2] = rgb.b;
        px[idx + 3] = 217; // ~85% opacity
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Show NDVI statistics
    if (ndviCount > 0) {
      console.log('[NDVI] min=' + ndviMin.toFixed(3) + ' max=' + ndviMax.toFixed(3) + ' pixels=' + ndviCount + ' noData=' + noData + ' bR=' + bR + ' bN=' + bN + ' stretch=' + stretch);
      var statsEl = $('#info-ndvi-range');
      if (statsEl) statsEl.textContent = ndviMin.toFixed(3) + ' \u2013 ' + ndviMax.toFixed(3);
      var statsRow = $('#ndvi-stats-row');
      if (statsRow) statsRow.classList.remove('hidden');
    } else {
      console.warn('[NDVI] Geen geldige pixels! noData=' + noData + ' bR=' + bR + ' bN=' + bN + ' vals-bR range: ' + gr.mins[bR] + '\u2013' + gr.maxs[bR] + '  vals-bN range: ' + gr.mins[bN] + '\u2013' + gr.maxs[bN]);
      toast('Geen geldige NDVI pixels — controleer de geselecteerde banden', true);
    }

    state.ndviLayer = L.imageOverlay(canvas.toDataURL('image/png'), getGeoBounds(), { opacity: 1 });
    ndviOverlay.addLayer(state.ndviLayer);
    legend.addTo(map);
    // Update legend labels with actual scale range
    setTimeout(function () {
      var ll = document.getElementById('legend-labels');
      if (ll && ndviCount > 0) {
        var mid = ((scaleMin + scaleMax) / 2).toFixed(2);
        ll.innerHTML = '<span>' + scaleMin.toFixed(2) + '</span><span>' + mid + '</span><span>' + scaleMax.toFixed(2) + '</span>';
      }
    }, 50);
  }

  function zoomToGeoTIFF() {
    map.fitBounds(getGeoBounds(), { padding: [30, 30] });
  }

  // ==========================================
  // STEP 3b: BRP LOADING & PARCEL SELECTION
  // ==========================================
  function startBRPLoading() {
    loadBRP();
    map.on('moveend', debounce(loadBRP, 600));
  }

  function debounce(fn, ms) {
    var timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  /**
   * Queries the PDOK BRP Gewaspercelen WFS for all field parcels within the
   * current map viewport using an OGC WFS 2.0 POST request with BBOX filter
   * in EPSG:28992 (RD New).  Results are displayed as a yellow GeoJSON layer.
   * Parcels respond to hover and click events for selection.
   * Runs automatically on map move (debounced) and requires zoom ≥ MIN_ZOOM_BRP.
   */
  async function loadBRP() {
    if (map.getZoom() < MIN_ZOOM_BRP) {
      $('#parcel-hint').textContent = 'Zoom verder in om BRP percelen te laden (zoom ≥ ' + MIN_ZOOM_BRP + ').';
      $('#parcel-hint').classList.remove('hidden');
      return;
    }
    if (state.brpLoading) return;

    $('#parcel-hint').textContent = 'BRP percelen laden...';
    state.brpLoading = true;

    try {
      var b = map.getBounds();
      var sw = proj4('EPSG:4326', 'EPSG:28992', [b.getWest(), b.getSouth()]);
      var ne = proj4('EPSG:4326', 'EPSG:28992', [b.getEast(), b.getNorth()]);

      var body =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<wfs:GetFeature service="WFS" version="2.0.0" count="500" ' +
        'xmlns:wfs="http://www.opengis.net/wfs/2.0" ' +
        'xmlns:fes="http://www.opengis.net/fes/2.0" ' +
        'xmlns:gml="http://www.opengis.net/gml/3.2" ' +
        'xmlns:brpgewaspercelen="http://brpgewaspercelen.geonovum.nl" ' +
        'outputFormat="application/json">' +
        '<wfs:Query typeNames="brpgewaspercelen:BrpGewas" srsName="urn:ogc:def:crs:EPSG::4326">' +
        '<fes:Filter>' +
        '<fes:BBOX>' +
        '<fes:ValueReference>brpgewaspercelen:geom</fes:ValueReference>' +
        '<gml:Envelope srsName="EPSG:28992">' +
        '<gml:lowerCorner>' + sw[0] + ' ' + sw[1] + '</gml:lowerCorner>' +
        '<gml:upperCorner>' + ne[0] + ' ' + ne[1] + '</gml:upperCorner>' +
        '</gml:Envelope>' +
        '</fes:BBOX>' +
        '</fes:Filter>' +
        '</wfs:Query>' +
        '</wfs:GetFeature>';

      var resp = await fetch(BRP_WFS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
        body: body
      });

      if (!resp.ok) throw new Error('WFS ' + resp.status);

      var data = await resp.json();

      // Server returns CRS84 (lon/lat) when srsName=EPSG:4326 — use directly
      state.brpGeoJSON = data;

      // Display
      brpOverlay.clearLayers();
      state.brpLayer = L.geoJSON(data, {
        style: function () {
          return {
            color: '#FFE000',      // bright yellow border
            weight: 3,
            fill: true,
            fillOpacity: 0.06,
            opacity: 1,
          };
        },
        onEachFeature: function (feature, layer) {
          layer.on('mouseover', function () {
            layer.setStyle({ fillOpacity: 0.18, weight: 4 });
          });
          layer.on('mouseout', function () {
            layer.setStyle({ fillOpacity: 0.06, weight: 3 });
          });
        layer.on('click', function (ev) {
            L.DomEvent.stopPropagation(ev);
            toggleParcel(feature);
          });
        }
      }).addTo(brpOverlay);

      var count = data.features ? data.features.length : 0;
      $('#parcel-hint').textContent = count + ' percelen geladen. Klik om te selecteren.';

    } catch (err) {
      console.error('BRP laden mislukt:', err);
      $('#parcel-hint').textContent = 'BRP laden mislukt. Probeer opnieuw.';
    } finally {
      state.brpLoading = false;
    }
  }

  function isParcelSelected(feature) {
    return state.selectedParcels.some(function (f) {
      if (f.id && feature.id) return f.id === feature.id;
      return JSON.stringify(f.geometry) === JSON.stringify(feature.geometry);
    });
  }

  function toggleParcel(feature) {
    var idx = -1;
    for (var i = 0; i < state.selectedParcels.length; i++) {
      var f = state.selectedParcels[i];
      var same = (f.id && feature.id) ? f.id === feature.id
        : JSON.stringify(f.geometry) === JSON.stringify(feature.geometry);
      if (same) { idx = i; break; }
    }
    var wasEmpty = state.selectedParcels.length === 0;
    if (idx >= 0) {
      state.selectedParcels.splice(idx, 1);
      toast('Perceel verwijderd.');
    } else {
      state.selectedParcels.push(feature);
      toast('Perceel toegevoegd! (' + state.selectedParcels.length + ' geselecteerd)');
    }
    updateSelectionDisplay(wasEmpty && state.selectedParcels.length > 0);
  }

  function updateSelectionDisplay(fitBounds) {
    selectionOverlay.clearLayers();

    if (state.selectedParcels.length === 0) {
      $('#parcel-info').classList.add('hidden');
      clearLegendCrop();
      return;
    }

    // Highlight all selected parcels (non-interactive so BRP clicks still work)
    var fc = { type: 'FeatureCollection', features: state.selectedParcels };
    state.selectedParcelsLayer = L.geoJSON(fc, {
      style: { color: '#00E5FF', weight: 4, fillColor: '#00E5FF', fillOpacity: 0.30, interactive: false }
    }).addTo(selectionOverlay);

    if (fitBounds) map.fitBounds(state.selectedParcelsLayer.getBounds(), { padding: [60, 60] });

    // Totals
    var totalArea = 0;
    state.selectedParcels.forEach(function (f) { try { totalArea += turf.area(f); } catch (e) {} });
    $('#parcel-count').textContent = state.selectedParcels.length + (state.selectedParcels.length === 1 ? ' perceel' : ' percelen');
    $('#parcel-area').textContent = (totalArea / 10000).toFixed(2) + ' ha';

    // Parcel list with inline crop history
    var listEl = $('#parcel-list');
    if (listEl) {
      listEl.innerHTML = state.selectedParcels.map(function (f, i) {
        var props = f.properties || {};
        var name = props.gewas || props.gewasgroep || props.GWS_GEWAS || ('Perceel ' + (i + 1));
        var area = '?';
        try { area = (turf.area(f) / 10000).toFixed(2) + ' ha'; } catch (e) {}
        return '<div class="parcel-hist-item">' +
          '<div class="phi-header">' +
          '<span class="phi-name">' + escapeHtml(name) + ' <span class="phi-area">— ' + escapeHtml(area) + '</span></span>' +
          '<button class="remove-parcel" data-i="' + i + '">×</button>' +
          '</div>' +
          '<div class="phi-hist" id="phi-hist-' + i + '"><span class="phi-loading">gewasgeschiedenis laden…</span></div>' +
          '</div>';
      }).join('');
      listEl.querySelectorAll('.remove-parcel').forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.selectedParcels.splice(parseInt(btn.dataset.i), 1);
          updateSelectionDisplay(false);
        });
      });
      // Async-load crop history for each parcel
      state.selectedParcels.forEach(function (parcel, i) {
        loadParcelHistory(parcel, i);
      });
    }

    $('#parcel-info').classList.remove('hidden');
    renderClasses();
    activateStep(4);
  }

  function computeArea(feature) {
    try {
      var area = turf.area(feature);
      return (area / 10000).toFixed(2) + ' ha';
    } catch (e) {
      return '-';
    }
  }

  // Map click fallback: fetch single parcel by point
  map.on('click', async function (e) {
    if (state.currentStep < 3 || !state.georaster) return;
    if (map.getZoom() < MIN_ZOOM_BRP) return;

    // If BRP parcels are displayed and user clicked one, the onEachFeature handler fires.
    // This fallback handles clicks where no BRP layer exists yet.
    if (state.brpLayer && state.brpGeoJSON && state.brpGeoJSON.features && state.brpGeoJSON.features.length > 0) return;

    try {
      var pt = proj4('EPSG:4326', 'EPSG:28992', [e.latlng.lng, e.latlng.lat]);
      var body =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<wfs:GetFeature service="WFS" version="2.0.0" ' +
        'xmlns:wfs="http://www.opengis.net/wfs/2.0" ' +
        'xmlns:fes="http://www.opengis.net/fes/2.0" ' +
        'xmlns:gml="http://www.opengis.net/gml/3.2" ' +
        'xmlns:brpgewaspercelen="http://brpgewaspercelen.geonovum.nl" ' +
        'outputFormat="application/json">' +
        '<wfs:Query typeNames="brpgewaspercelen:BrpGewas" srsName="urn:ogc:def:crs:EPSG::4326">' +
        '<fes:Filter>' +
        '<fes:Intersects>' +
        '<fes:ValueReference>brpgewaspercelen:geom</fes:ValueReference>' +
        '<gml:Point srsName="EPSG:28992"><gml:pos>' + pt[0] + ' ' + pt[1] + '</gml:pos></gml:Point>' +
        '</fes:Intersects>' +
        '</fes:Filter>' +
        '</wfs:Query>' +
        '</wfs:GetFeature>';

      var resp = await fetch(BRP_WFS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
        body: body
      });
      var data = await resp.json();
      if (data.features && data.features.length > 0) {
        toggleParcel(data.features[0]); // already in WGS84 lon/lat
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Clear all selected parcels
  var clearParcelsBtn = $('#clear-parcels-btn');
  if (clearParcelsBtn) {
    clearParcelsBtn.addEventListener('click', function () {
      state.selectedParcels = [];
      updateSelectionDisplay(false);
      toast('Selectie gewist.');
    });
  }

  // ==========================================
  // CROP HISTORY (SIDEBAR)
  // ==========================================

  function parcelKey(feature) {
    try {
      var c = turf.centroid(feature).geometry.coordinates;
      return c[0].toFixed(4) + ',' + c[1].toFixed(4);
    } catch (e) {
      return JSON.stringify((feature.properties || {})).substring(0, 60);
    }
  }

  function renderParcelHistory(histEl, byYear) {
    var years = Object.keys(byYear).sort(function (a, b) { return Number(b) - Number(a); });
    if (years.length === 0) {
      histEl.innerHTML = '<span class="phi-none">geen data beschikbaar</span>';
      return;
    }
    histEl.innerHTML = years.map(function (y) {
      return '<div class="phi-row"><span class="phi-yr">' + escapeHtml(y) +
        '</span><span class="phi-crop">' + escapeHtml(byYear[y]) + '</span></div>';
    }).join('');
  }

  async function loadParcelHistory(feature, idx) {
    var histEl = document.getElementById('phi-hist-' + idx);
    if (!histEl) return;

    var key = parcelKey(feature);
    if (state.parcelHistoryCache[key]) {
      renderParcelHistory(histEl, state.parcelHistoryCache[key]);
      return;
    }

    var centroid;
    try { centroid = turf.centroid(feature).geometry.coordinates; }
    catch (e) { histEl.innerHTML = '<span class="phi-error">fout</span>'; return; }

    var pt28992 = proj4('EPSG:4326', 'EPSG:28992', centroid);
    var body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<wfs:GetFeature service="WFS" version="2.0.0" count="50" ' +
      'xmlns:wfs="http://www.opengis.net/wfs/2.0" ' +
      'xmlns:fes="http://www.opengis.net/fes/2.0" ' +
      'xmlns:gml="http://www.opengis.net/gml/3.2" ' +
      'xmlns:brpgewaspercelen="http://brpgewaspercelen.geonovum.nl" ' +
      'outputFormat="application/json">' +
      '<wfs:Query typeNames="brpgewaspercelen:BrpGewas" srsName="urn:ogc:def:crs:EPSG::4326">' +
      '<fes:Filter>' +
      '<fes:Intersects>' +
      '<fes:ValueReference>brpgewaspercelen:geom</fes:ValueReference>' +
      '<gml:Point srsName="EPSG:28992"><gml:pos>' + pt28992[0] + ' ' + pt28992[1] + '</gml:pos></gml:Point>' +
      '</fes:Intersects>' +
      '</fes:Filter>' +
      '</wfs:Query>' +
      '</wfs:GetFeature>';

    try {
      var resp = await fetch(BRP_WFS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
        body: body
      });
      if (!resp.ok) throw new Error('WFS ' + resp.status);
      var data = await resp.json();

      var byYear = {};
      (data.features || []).forEach(function (f) {
        var p = f.properties || {};
        var year = p.registratiejaar || p.RegistratieJaar || p.jaar || '?';
        var crop = p.gewas || p.GWS_GEWAS || p.gewasgroep || p.gewascode || '—';
        // Keep newest entry per year if multiple features exist for same year
        if (!byYear[year]) byYear[year] = crop;
      });

      state.parcelHistoryCache[key] = byYear;
      // histEl might have been removed if user deselected parcel — re-check
      var el = document.getElementById('phi-hist-' + idx);
      if (el) renderParcelHistory(el, byYear);
      // Also reflect the history in the map legend (last loaded parcel wins)
      updateLegendCrop(feature, byYear);

    } catch (err) {
      console.warn('Gewasgeschiedenis laden mislukt:', err);
      var el = document.getElementById('phi-hist-' + idx);
      if (el) el.innerHTML = '<span class="phi-error">niet beschikbaar</span>';
    }
  }

  // Legacy stub — no longer used (history shown in sidebar)
  async function showCropHistory(feature, latlng) {
    // Find centroid of the parcel
    var centroid;
    try {
      centroid = turf.centroid(feature).geometry.coordinates; // [lon, lat]
    } catch (e) {
      centroid = [latlng.lng, latlng.lat];
    }

    var pt28992 = proj4('EPSG:4326', 'EPSG:28992', centroid);

    // Query all BRP features at this point (all years available)
    var body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<wfs:GetFeature service="WFS" version="2.0.0" count="50" ' +
      'xmlns:wfs="http://www.opengis.net/wfs/2.0" ' +
      'xmlns:fes="http://www.opengis.net/fes/2.0" ' +
      'xmlns:gml="http://www.opengis.net/gml/3.2" ' +
      'xmlns:brpgewaspercelen="http://brpgewaspercelen.geonovum.nl" ' +
      'outputFormat="application/json">' +
      '<wfs:Query typeNames="brpgewaspercelen:BrpGewas" srsName="urn:ogc:def:crs:EPSG::4326">' +
      '<fes:Filter>' +
      '<fes:Intersects>' +
      '<fes:ValueReference>brpgewaspercelen:geom</fes:ValueReference>' +
      '<gml:Point srsName="EPSG:28992"><gml:pos>' + pt28992[0] + ' ' + pt28992[1] + '</gml:pos></gml:Point>' +
      '</fes:Intersects>' +
      '</fes:Filter>' +
      '</wfs:Query>' +
      '</wfs:GetFeature>';

    // Show placeholder popup immediately
    var popup = L.popup({ maxWidth: 280 })
      .setLatLng(latlng)
      .setContent('<div class="crop-history-popup"><b>Gewasgeschiedenis laden…</b></div>')
      .openOn(map);

    try {
      var resp = await fetch(BRP_WFS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
        body: body
      });
      if (!resp.ok) throw new Error('WFS ' + resp.status);
      var data = await resp.json();

      // Group features by year
      var byYear = {};
      if (data.features) {
        data.features.forEach(function (f) {
          var props = f.properties || {};
          var year = props.registratiejaar || props.RegistratieJaar || props.jaar || '?';
          if (!byYear[year]) byYear[year] = [];
          var crop = props.gewas || props.GWS_GEWAS || props.gewascode || props.gewasgroep || '—';
          byYear[year].push(crop);
        });
      }

      var years = Object.keys(byYear).sort(function (a, b) { return Number(b) - Number(a); });

      var currentProps = feature.properties || {};
      var currentCrop = currentProps.gewas || currentProps.GWS_GEWAS || currentProps.gewasgroep || '—';
      var currentYear = currentProps.registratiejaar || currentProps.RegistratieJaar || '—';
      var area = '—';
      try { area = (turf.area(feature) / 10000).toFixed(2) + ' ha'; } catch (e) {}

      var html = '<div class="crop-history-popup">' +
        '<div class="chp-title">📋 Perceelinformatie</div>' +
        '<div class="chp-current">' +
        '<span class="chp-badge">' + currentYear + '</span>' +
        '<span><b>' + currentCrop + '</b></span>' +
        '<span class="chp-area">' + area + '</span>' +
        '</div>';

      if (years.length > 0) {
        var hasHistory = years.some(function (y) { return String(y) !== String(currentYear); });
        if (hasHistory || years.length > 1) {
          html += '<div class="chp-hist-title">Voorgaande jaren</div><table class="chp-table">';
          years.forEach(function (y) {
            if (String(y) === String(currentYear) && byYear[y].length === 1 && byYear[y][0] === currentCrop) return;
            html += '<tr><td class="chp-yr">' + y + '</td><td>' + byYear[y].join(', ') + '</td></tr>';
          });
          html += '</table>';
        } else {
          html += '<p class="chp-note">Alleen het huidige jaar beschikbaar in de WFS.<br>Historische data is beperkt beschikbaar via PDOK.</p>';
        }
      } else {
        html += '<p class="chp-note">Geen historische gewasdata gevonden voor dit punt.</p>';
      }

      html += '</div>';
      popup.setContent(html);

    } catch (err) {
      console.warn('Gewasgeschiedenis ophalen mislukt:', err);
      var fallbackProps = feature.properties || {};
      var crop = fallbackProps.gewas || fallbackProps.gewasgroep || '—';
      var yr = fallbackProps.registratiejaar || '—';
      popup.setContent(
        '<div class="crop-history-popup">' +
        '<div class="chp-title">📋 Perceelinformatie</div>' +
        '<div class="chp-current"><span class="chp-badge">' + yr + '</span><b>' + crop + '</b></div>' +
        '<p class="chp-note">Gewasgeschiedenis kon niet worden geladen.</p>' +
        '</div>'
      );
    }
  }

  // ==========================================
  // STEP 4: TASK MAP CONFIGURATION
  // ==========================================
  gridSlider.addEventListener('input', function () {
    state.gridSize = parseInt(gridSlider.value);
    gridValue.textContent = state.gridSize + ' m';
  });

  if (gridAngleSlider) {
    gridAngleSlider.addEventListener('input', function () {
      state.gridAngle = parseInt(gridAngleSlider.value);
      gridAngleValue.textContent = state.gridAngle + '°';
    });
  }

  if (autoAngleBtn) {
    autoAngleBtn.addEventListener('click', function () {
      if (!state.selectedParcels || state.selectedParcels.length === 0) {
        toast('Selecteer eerst een perceel.', true);
        return;
      }
      var angle = computeOptimalGridAngle(state.selectedParcels);
      state.gridAngle = angle;
      if (autoAngleHint) {
        autoAngleHint.textContent = 'Rijrichting: ' + angle + '° (langste zijde perceel)';
        autoAngleHint.style.display = '';
      }
      toast('Rijrichting ingesteld op ' + angle + '°');
    });
  }

  unitSelect.addEventListener('change', function () {
    state.unit = unitSelect.value;
  });

  function renderClasses() {
    classesContainer.innerHTML =
      '<div class="class-labels">' +
      '<span></span><span>Naam</span><span>Van</span><span>Tot</span><span>Dosering</span><span></span>' +
      '</div>';

    state.classes.forEach(function (cls, i) {
      var row = document.createElement('div');
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

    // Event delegation
    classesContainer.querySelectorAll('input').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var i = parseInt(inp.dataset.i);
        var field = inp.dataset.field;
        if (inp.type === 'color') {
          state.classes[i].color = inp.value;
        } else if (field === 'name') {
          state.classes[i].name = inp.value;
        } else if (field) {
          state.classes[i][field] = parseFloat(inp.value);
        }
      });
    });

    classesContainer.querySelectorAll('.remove-class').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.classes.splice(parseInt(btn.dataset.i), 1);
        renderClasses();
      });
    });
  }

  addClassBtn.addEventListener('click', function () {
    var last = state.classes[state.classes.length - 1];
    state.classes.push({
      name: 'Klasse ' + (state.classes.length + 1),
      min: last ? last.max : 0,
      max: 1,
      rate: 50,
      color: '#9e9e9e'
    });
    renderClasses();
  });

  // ==========================================
  // STEP 4b: GENERATE TASK MAP
  // ==========================================

  /**
   * Handles a GeoTIFF File selected by the user (input or drag-drop).
   * Reads only the file headers via a Blob URL (byte-range, very fast even
   * for multi-GB COGs), then:
   *  1. Reads a downscaled overview raster (≤ 1024 px on longest side)
   *  2. Detects CRS, band count, noData value, per-band spectral metadata
   *  3. Dispatches to displayNDVI() for single-band / RGB, or to
   *     populateBandSelectors() so the user can pick Red + NIR bands.
   * @param {File} file
   */
  // (handleFileUpload is defined directly after the drag-drop listeners)

  /**
   * Find the bearing of the LONGEST edge across all selected parcel polygons.
   * The grid is then rotated to that bearing so rows run parallel to the field's
   * longest side — minimising headland turns for the tractor.
   *
   * Uses cosLat-corrected edge lengths so that E-W and N-S edges are compared
   * fairly at any latitude.
   * Does NOT rely on turf.convex — works directly on polygon rings.
   */
  function computeOptimalGridAngle(parcels) {
    var bestAngle = 0, bestLen = -1;
    try {
      parcels.forEach(function (parcel) {
        var geom = parcel.geometry;
        if (!geom) return;
        var rings = geom.type === 'Polygon'
          ? geom.coordinates
          : geom.coordinates.reduce(function (a, p) { return a.concat(p); }, []);
        var outer = rings[0];
        if (!outer || outer.length < 2) return;

        // Average latitude of this ring for cosLat correction
        var avgLat = outer.reduce(function (s, c) { return s + c[1]; }, 0) / outer.length;
        var cosLat = Math.cos(avgLat * Math.PI / 180);

        for (var i = 0; i < outer.length - 1; i++) {
          // Physical E-W distance proportional (corrected) and N-S distance
          var dx = (outer[i + 1][0] - outer[i][0]) * cosLat;
          var dy = outer[i + 1][1] - outer[i][1];
          var len = Math.sqrt(dx * dx + dy * dy);
          if (len > bestLen) {
            bestLen = len;
            // atan2(dx, dy) = bearing from North (clockwise positive = East)
            var deg = Math.atan2(dx, dy) * 180 / Math.PI;
            // Normalise to [-90, 90]:
            // Edges going NW and SE are the same "direction" for grid purposes
            while (deg > 90) deg -= 180;
            while (deg < -90) deg += 180;
            bestAngle = Math.round(deg);
          }
        }
      });
    } catch (e) {
      console.warn('computeOptimalGridAngle failed:', e);
    }
    // Negate: atan2 convention vs rotation convention differ by sign
    return -bestAngle;
  }

  /**
   * Rotate a [lon, lat] coordinate by `angleDeg` around a pivot [lon, lat].
   * Uses a flat-earth approximation which is accurate enough for farm fields.
   */
  function rotateCoord(coord, pivot, angleDeg) {
    var cos = Math.cos(angleDeg * Math.PI / 180);
    var sin = Math.sin(angleDeg * Math.PI / 180);
    // Scale lat differences by cos(lat) so the rotation is isometric
    var cosLat = Math.cos(pivot[1] * Math.PI / 180);
    var dx = (coord[0] - pivot[0]) * cosLat;
    var dy = coord[1] - pivot[1];
    return [
      pivot[0] + (dx * cos - dy * sin) / cosLat,
      pivot[1] + (dx * sin + dy * cos)
    ];
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

  generateBtn.addEventListener('click', function () {
    if (!state.selectedParcels || state.selectedParcels.length === 0) {
      toast('Selecteer eerst een of meer percelen.', true);
      return;
    }
    showLoading('Taakkaart genereren...');
    setTimeout(function () {
      try {
        generateTaskMap();
        hideLoading();
        toast('Taakkaart gegenereerd!');
        renderExportStats();
        activateStep(5);
      } catch (err) {
        hideLoading();
        console.error(err);
        toast('Fout bij genereren: ' + err.message, true);
      }
    }, 50);
  });

  /**
   * Generates the variable-rate task map as a GeoJSON FeatureCollection and
   * renders it on the map.  Algorithm:
   *  1. If gridAngle ≠ 0, rotate all parcels by −angle into axis-aligned space
   *  2. Build a regular squareGrid over the combined parcel bbox
   *  3. Intersect each grid cell with each parcel
   *  4. Rotate clipped cells back to geographic orientation (+angle)
   *  5. Sample mean NDVI per cell via sampleNDVI()
   *  6. Classify each cell into a dosering class via classifyNDVI()
   * Result is stored in state.taskMapFC and displayed via gridOverlay.
   */
  function generateTaskMap() {
    var parcels = state.selectedParcels;
    var gr = state.georaster;
    var gridSize = state.gridSize;
    var angle = state.gridAngle || 0;

    // Combined bbox + centre of all selected parcels
    var allFC = { type: 'FeatureCollection', features: parcels };
    var center = turf.centroid(allFC).geometry.coordinates; // [lon, lat]

    var workParcels = parcels;
    var workFC = allFC;

    // If rotated, temporarily rotate parcels to axis-aligned space,
    // generate the grid there, then rotate everything back.
    if (angle !== 0) {
      workParcels = parcels.map(function (f) { return rotateFeature(f, center, -angle); });
      workFC = { type: 'FeatureCollection', features: workParcels };
    }

    var bbox = turf.bbox(workFC);
    var grid = turf.squareGrid(bbox, gridSize / 1000, { units: 'kilometers' });

    var features = [];
    var epsg = state.geotiffEPSG;

    grid.features.forEach(function (cell) {
      for (var p = 0; p < workParcels.length; p++) {
        var clipped;
        try {
          clipped = turf.intersect(cell, workParcels[p]);
        } catch (e) {
          continue;
        }
        if (!clipped) continue;

        // Rotate cell back to geographic orientation before NDVI sampling & display
        var geoCell = angle !== 0 ? rotateFeature(clipped, center, angle) : clipped;

        // Sample NDVI using the geographic (un-rotated) cell polygon
        var meanNDVI = sampleNDVI(geoCell, gr, epsg);
        if (isNaN(meanNDVI)) continue;

        var cls = classifyNDVI(meanNDVI);

        geoCell.properties = {
          ndvi: Math.round(meanNDVI * 1000) / 1000,
          klasse: cls.name,
          dosering: cls.rate,
          eenheid: state.unit,
          kleur: cls.color
        };

        features.push(geoCell);
      }
    });

    state.taskMapFC = { type: 'FeatureCollection', features: features };

    // Display on map
    gridOverlay.clearLayers();
    state.gridLayer = L.geoJSON(state.taskMapFC, {
      style: function (f) {
        return {
          fillColor: f.properties.kleur,
          fillOpacity: 0.7,
          color: '#ffffff',
          weight: 1,
          opacity: 0.8
        };
      },
      onEachFeature: function (f, layer) {
        layer.bindPopup(
          '<b>' + f.properties.klasse + '</b><br>' +
          'NDVI: ' + f.properties.ndvi + '<br>' +
          'Dosering: ' + f.properties.dosering + ' ' + f.properties.eenheid
        );
      }
    }).addTo(gridOverlay);
  }

  /**
   * Samples the mean NDVI value within a GeoJSON polygon by reading raster
   * pixels that fall inside the polygon's bounding box.  For performance,
   * sampling is limited to a maximum of ~2500 pixels (step every N rows/cols).
   * @param {object} polygon - GeoJSON Feature with Polygon geometry (WGS84)
   * @param {object} gr      - georaster object with width/height/values arrays
   * @param {string|null} epsg - EPSG key for reprojecting bbox to raster CRS
   * @returns {number} mean NDVI, or NaN if no valid pixels were found
   */
  function sampleNDVI(polygon, gr, epsg) {
    var cellBbox = turf.bbox(polygon);
    // cellBbox is [minLon, minLat, maxLon, maxLat] in EPSG:4326

    var xmin, ymin, xmax, ymax;
    if (epsg && epsg !== 'EPSG:4326') {
      try {
        var sw = proj4('EPSG:4326', epsg, [cellBbox[0], cellBbox[1]]);
        var ne = proj4('EPSG:4326', epsg, [cellBbox[2], cellBbox[3]]);
        xmin = sw[0]; ymin = sw[1]; xmax = ne[0]; ymax = ne[1];
      } catch (e) {
        xmin = cellBbox[0]; ymin = cellBbox[1]; xmax = cellBbox[2]; ymax = cellBbox[3];
      }
    } else {
      xmin = cellBbox[0]; ymin = cellBbox[1];
      xmax = cellBbox[2]; ymax = cellBbox[3];
    }

    // Convert to pixel coordinates
    var col0 = Math.max(0, Math.floor((xmin - gr.xmin) / gr.pixelWidth));
    var col1 = Math.min(gr.width - 1, Math.ceil((xmax - gr.xmin) / gr.pixelWidth));
    var row0 = Math.max(0, Math.floor((gr.ymax - ymax) / Math.abs(gr.pixelHeight)));
    var row1 = Math.min(gr.height - 1, Math.ceil((gr.ymax - ymin) / Math.abs(gr.pixelHeight)));

    if (col0 > col1 || row0 > row1) return NaN;

    var sum = 0, count = 0;
    var noData = gr.noDataValue;
    var isFloat = state.bandMetas && state.bandMetas.length > 0 && state.bandMetas[0].sampleFormat === 3;
    var noDataEps = (isFloat && noData !== null) ? 1e-6 : 0;
    function nd(v) {
      if (v === undefined || v === null || isNaN(v)) return true;
      if (noData === null) return false;
      return noDataEps > 0 ? Math.abs(v - noData) < noDataEps : v === noData;
    }

    // Limit samples for performance (max ~2500 pixels)
    var stepR = Math.max(1, Math.floor((row1 - row0) / 50));
    var stepC = Math.max(1, Math.floor((col1 - col0) / 50));

    // Detect alpha channel for masking transparent background pixels
    var sampleAlphaBand = gr.numberOfRasters >= 4 ? gr.numberOfRasters - 1 : -1;

    for (var r = row0; r <= row1; r += stepR) {
      for (var c = col0; c <= col1; c += stepC) {
        // Skip transparent pixels (alpha = 0)
        if (sampleAlphaBand >= 0 && gr.values[sampleAlphaBand][r] && gr.values[sampleAlphaBand][r][c] === 0) continue;
        var ndvi;
        if (state.isPreCalc) {
          var pv = gr.values[0][r] ? gr.values[0][r][c] : undefined;
          if (nd(pv)) continue;
          ndvi = pv;
        } else if (state.isRGBProxy) {
          // RGB export: proxy NDVI = (Green - Red) / (Green + Red)
          // High green = healthy vegetation → high proxy NDVI
          var rrv = gr.values[state.bandRed][r] ? gr.values[state.bandRed][r][c] : undefined;
          var ggv = gr.values[state.bandNIR][r] ? gr.values[state.bandNIR][r][c] : undefined;
          if (rrv === undefined || ggv === undefined) continue;
          if ((rrv + ggv) === 0) continue;
          ndvi = (ggv - rrv) / (ggv + rrv);
        } else {
          var rv = gr.values[state.bandRed][r] ? gr.values[state.bandRed][r][c] : undefined;
          var nv = gr.values[state.bandNIR][r] ? gr.values[state.bandNIR][r][c] : undefined;
          if (nd(rv) || nd(nv)) continue;
          if ((rv + nv) === 0) continue;
          ndvi = (nv - rv) / (nv + rv);
        }
        if (!nd(ndvi)) {
          sum += ndvi;
          count++;
        }
      }
    }

    return count > 0 ? sum / count : NaN;
  }

  function classifyNDVI(ndvi) {
    for (var i = 0; i < state.classes.length; i++) {
      var c = state.classes[i];
      if (ndvi >= c.min && ndvi < c.max) return c;
    }
    // Fallback: closest class
    return state.classes[state.classes.length - 1];
  }

  // ==========================================
  // STEP 5: EXPORT
  // ==========================================
  function renderExportStats() {
    if (!state.taskMapFC) return;
    var features = state.taskMapFC.features;
    var totalArea = 0;
    var classCounts = {};

    features.forEach(function (f) {
      var a = turf.area(f);
      totalArea += a;
      var k = f.properties.klasse;
      if (!classCounts[k]) classCounts[k] = { count: 0, area: 0, color: f.properties.kleur, rate: f.properties.dosering };
      classCounts[k].count++;
      classCounts[k].area += a;
    });

    var html =
      '<div class="stat-row"><span class="stat-label">Totaal cellen</span><span class="stat-value">' + features.length + '</span></div>' +
      '<div class="stat-row"><span class="stat-label">Totaal oppervlakte</span><span class="stat-value">' + (totalArea / 10000).toFixed(2) + ' ha</span></div>' +
      '<hr style="margin:8px 0;border:none;border-top:1px solid var(--border)">';

    Object.keys(classCounts).forEach(function (k) {
      var c = classCounts[k];
      html +=
        '<div class="stat-class">' +
        '<span class="stat-class-color" style="background:' + escapeHtml(c.color) + '"></span>' +
        '<span style="flex:1">' + escapeHtml(k) + '</span>' +
        '<span>' + Number(c.count) + ' cellen</span>' +
        '<span style="margin-left:8px;font-weight:600">' + Number(c.rate) + ' ' + escapeHtml(state.unit) + '</span>' +
        '</div>';
    });

    $('#export-stats').innerHTML = html;
  }

  exportShpBtn.addEventListener('click', function () {
    if (!state.taskMapFC) { toast('Genereer eerst een taakkaart.', true); return; }
    try {
      var name = exportNameInput.value || 'taakkaart';
      var blob = buildShapefileZip(state.taskMapFC, name);
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name + '.zip';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast('Shapefile download gestart.');
    } catch (err) {
      console.error(err);
      toast('Export fout: ' + err.message, true);
    }
  });

  exportGeoBtn.addEventListener('click', function () {
    if (!state.taskMapFC) { toast('Genereer eerst een taakkaart.', true); return; }

    var name = exportNameInput.value || 'taakkaart';
    var exportFC = {
      type: 'FeatureCollection',
      features: state.taskMapFC.features.map(function (f) {
        return {
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            ndvi: f.properties.ndvi,
            klasse: f.properties.klasse,
            dosering: f.properties.dosering,
            eenheid: f.properties.eenheid
          }
        };
      })
    };

    var json = JSON.stringify(exportFC, null, 2);
    var blob = new Blob([json], { type: 'application/geo+json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name + '.geojson';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('GeoJSON download gestart.');
  });

  // ==========================================
  // INIT
  // ==========================================
  renderClasses();
  activateStep(1);

  // Mobile sidebar toggle
  (function () {
    var sidebar = document.querySelector('.sidebar');
    var btn = document.getElementById('mobile-toggle');
    var lbl = document.getElementById('mobile-toggle-label');
    if (!btn || !sidebar) return;
    var open = true; // start expanded
    function update() {
      if (open) {
        sidebar.classList.remove('collapsed');
        btn.classList.add('panel-open');
        lbl.textContent = 'Verberg';
      } else {
        sidebar.classList.add('collapsed');
        btn.classList.remove('panel-open');
        lbl.textContent = 'Paneel';
      }
    }
    btn.addEventListener('click', function () {
      open = !open;
      update();
      setTimeout(function () { map.invalidateSize(); }, 360);
    });
    // Tap drag handle (sidebar header) toggles on mobile
    var hdr = sidebar.querySelector('.sidebar-header');
    if (hdr) {
      hdr.addEventListener('click', function (e) {
        if (window.innerWidth <= 768) {
          open = !open;
          update();
          setTimeout(function () { map.invalidateSize(); }, 360);
        }
      });
    }
    update();
  })();

  // ==========================================
  // SHAPEFILE + ZIP WRITER  (pure JS)
  // ==========================================

  var _CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();

  function _crc32(u8) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) crc = _CRC_TABLE[(crc ^ u8[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function _concat(arrs) {
    var n = 0; arrs.forEach(function (a) { n += a.length; });
    var out = new Uint8Array(n), o = 0;
    arrs.forEach(function (a) { out.set(a, o); o += a.length; });
    return out;
  }

  function _buildZipBlob(files) {
    var enc = new TextEncoder();
    var lparts = [], cparts = [], off = 0;
    files.forEach(function (f) {
      var nm = enc.encode(f.name), crc = _crc32(f.data), sz = f.data.length;
      var lh = new DataView(new ArrayBuffer(30 + nm.length));
      lh.setUint32(0, 0x04034b50, false); lh.setUint16(4, 20, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true);
      lh.setUint16(26, nm.length, true);
      new Uint8Array(lh.buffer).set(nm, 30);
      var cd = new DataView(new ArrayBuffer(46 + nm.length));
      cd.setUint32(0, 0x02014b50, false);
      cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, sz, true); cd.setUint32(24, sz, true);
      cd.setUint16(28, nm.length, true); cd.setUint32(42, off, true);
      new Uint8Array(cd.buffer).set(nm, 46);
      lparts.push(new Uint8Array(lh.buffer), f.data);
      cparts.push(new Uint8Array(cd.buffer));
      off += 30 + nm.length + sz;
    });
    var cdSz = cparts.reduce(function (s, p) { return s + p.length; }, 0);
    var eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, false);
    eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, cdSz, true); eocd.setUint32(16, off, true);
    return new Blob(lparts.concat(cparts).concat([new Uint8Array(eocd.buffer)]), { type: 'application/zip' });
  }

  /**
   * Builds a Shapefile archive (.zip containing .shp / .shx / .dbf / .prj)
   * from a GeoJSON FeatureCollection, entirely in pure JavaScript.
   * Only Polygon and MultiPolygon geometries are included.
   * The .prj file declares WGS84 geographic coordinates (EPSG:4326).
   * @param {object} geojson - GeoJSON FeatureCollection
   * @param {string} name    - base filename (without extension)
   * @returns {Blob} ZIP Blob ready for URL.createObjectURL / download
   */
  function buildShapefileZip(geojson, name) {
    var feats = geojson.features.filter(function (f) {
      return f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
    });

    // ---- SHP record buffers ----
    var recs = feats.map(function (f) {
      var rings = f.geometry.type === 'Polygon'
        ? f.geometry.coordinates
        : f.geometry.coordinates.reduce(function (a, p) { return a.concat(p); }, []);
      var nPts = rings.reduce(function (s, r) { return s + r.length; }, 0);
      var ab = new ArrayBuffer(44 + 4 * rings.length + 16 * nPts);
      var v = new DataView(ab), o = 0;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      rings.forEach(function (r) {
        r.forEach(function (p) {
          if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
          if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
        });
      });
      v.setInt32(o, 5, true); o += 4;
      v.setFloat64(o, x0, true); o += 8; v.setFloat64(o, y0, true); o += 8;
      v.setFloat64(o, x1, true); o += 8; v.setFloat64(o, y1, true); o += 8;
      v.setInt32(o, rings.length, true); o += 4;
      v.setInt32(o, nPts, true); o += 4;
      var pi = 0;
      rings.forEach(function (r) { v.setInt32(o, pi, true); o += 4; pi += r.length; });
      rings.forEach(function (r) {
        r.forEach(function (p) { v.setFloat64(o, p[0], true); o += 8; v.setFloat64(o, p[1], true); o += 8; });
      });
      return { u8: new Uint8Array(ab), x0: x0, y0: y0, x1: x1, y1: y1 };
    });

    // ---- Global bbox ----
    var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    recs.forEach(function (r) {
      if (r.x0 < bx0) bx0 = r.x0; if (r.y0 < by0) by0 = r.y0;
      if (r.x1 > bx1) bx1 = r.x1; if (r.y1 > by1) by1 = r.y1;
    });
    if (!isFinite(bx0)) { bx0 = 0; by0 = 0; bx1 = 0; by1 = 0; }

    function makeHdr(words) {
      var ab = new ArrayBuffer(100), v = new DataView(ab);
      v.setInt32(0, 9994, false); v.setInt32(24, words, false);
      v.setInt32(28, 1000, true); v.setInt32(32, 5, true);
      v.setFloat64(36, bx0, true); v.setFloat64(44, by0, true);
      v.setFloat64(52, bx1, true); v.setFloat64(60, by1, true);
      return new Uint8Array(ab);
    }

    // ---- SHP + SHX bodies ----
    var shpBodyLen = recs.reduce(function (s, r) { return s + 8 + r.u8.length; }, 0);
    var shpBody = new ArrayBuffer(shpBodyLen), shpV = new DataView(shpBody), shpPos = 0;
    var shxBody = new ArrayBuffer(recs.length * 8), shxV = new DataView(shxBody);
    recs.forEach(function (r, i) {
      var offW = (100 + shpPos) / 2;
      shxV.setInt32(i * 8,     offW,             false);
      shxV.setInt32(i * 8 + 4, r.u8.length / 2, false);
      shpV.setInt32(shpPos,     i + 1,            false);
      shpV.setInt32(shpPos + 4, r.u8.length / 2, false);
      shpPos += 8;
      new Uint8Array(shpBody, shpPos).set(r.u8);
      shpPos += r.u8.length;
    });
    var shpFile = _concat([makeHdr((100 + shpBodyLen) / 2), new Uint8Array(shpBody)]);
    var shxFile = _concat([makeHdr((100 + recs.length * 8) / 2), new Uint8Array(shxBody)]);

    // ---- DBF ----
    var flds = [
      { n: 'NDVI',     t: 'N', l: 10, d: 3 },
      { n: 'KLASSE',   t: 'C', l: 30, d: 0 },
      { n: 'DOSERING', t: 'N', l: 10, d: 0 },
      { n: 'EENHEID',  t: 'C', l: 20, d: 0 },
    ];
    var recSz = 1 + flds.reduce(function (s, f) { return s + f.l; }, 0);
    var hdrSz = 33 + flds.length * 32;
    var dbfBuf = new ArrayBuffer(hdrSz + feats.length * recSz + 1);
    var dbfV = new DataView(dbfBuf), dbfU = new Uint8Array(dbfBuf);
    var now = new Date();
    dbfV.setUint8(0, 3);
    dbfV.setUint8(1, now.getFullYear() - 1900);
    dbfV.setUint8(2, now.getMonth() + 1);
    dbfV.setUint8(3, now.getDate());
    dbfV.setUint32(4, feats.length, true);
    dbfV.setUint16(8, hdrSz, true);
    dbfV.setUint16(10, recSz, true);
    flds.forEach(function (f, fi) {
      var base = 32 + fi * 32;
      for (var j = 0; j < f.n.length; j++) dbfU[base + j] = f.n.charCodeAt(j);
      dbfU[base + 11] = f.t.charCodeAt(0);
      dbfU[base + 16] = f.l;
      dbfU[base + 17] = f.d;
    });
    dbfU[32 + flds.length * 32] = 0x0D;
    feats.forEach(function (feat, fi) {
      var p = feat.properties || {}, base = hdrSz + fi * recSz;
      dbfU[base] = 0x20;
      var col = 1;
      flds.forEach(function (f) {
        var key = f.n.toLowerCase();
        var raw = p[key] != null ? String(p[key]) : '';
        var val = f.t === 'N'
          ? raw.padStart(f.l).substring(0, f.l)
          : raw.padEnd(f.l).substring(0, f.l);
        for (var j = 0; j < f.l; j++) dbfU[base + col + j] = val.charCodeAt(j) || 0x20;
        col += f.l;
      });
    });
    dbfU[hdrSz + feats.length * recSz] = 0x1A;

    var prj = new TextEncoder().encode('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]');

    return _buildZipBlob([
      { name: name + '.shp', data: shpFile },
      { name: name + '.shx', data: shxFile },
      { name: name + '.dbf', data: new Uint8Array(dbfBuf) },
      { name: name + '.prj', data: prj },
    ]);
  }

})();
