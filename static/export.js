/* ===================================================
   export.js — SHP, GeoJSON, CSV and ISOXML export

   Provides four download formats for the generated task map:

   GeoJSON  — direct JSON serialisation of state.taskMapFC
   CSV      — tabular cells with NDVI, class, dosage and area
   ISOXML   — ISO 11783-10 TASKDATA.XML + binary GRD grid (type 1),
              rasterised at the current gridSize resolution
   Shapefile — pure-JS .shp / .shx / .dbf / .prj packed in a ZIP

   The ZIP format is implemented without any external library;
   only DEFLATE-free stored entries (method 0) are used to keep
   the code self-contained and dependency-free.
   =================================================== */

import { state, VEGETATION_INDICES } from './state.js?v=1';
import { toast, escapeHtml, escapeXml, showLoading, hideLoading } from './utils.js?v=1';
import { map, gridOverlay, brpOverlay } from './map.js?v=1';
import { getGeoBounds } from './ndvi.js?v=1';

const { t, tf } = window;

// ==========================================
// DOM REFERENCES
// ==========================================
const exportShpBtn    = document.querySelector('#export-shp-btn');
const exportGeoBtn    = document.querySelector('#export-geojson-btn');
const exportNameInput = document.querySelector('#export-name');

// ==========================================
// GEOJSON EXPORT
// ==========================================
exportGeoBtn.addEventListener('click', function () {
  if (!state.taskMapFC) { toast(t('toastGenerateFirst'), true); return; }
  const name = exportNameInput.value || _defaultName('taskmap');
  const exportFC = {
    type: 'FeatureCollection',
    features: state.taskMapFC.features.map(f => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: { ndvi: f.properties.ndvi, 'class': f.properties['class'], dose: f.properties.dose, unit: f.properties.unit }
    }))
  };
  const blob = new Blob([JSON.stringify(exportFC, null, 2)], { type: 'application/geo+json' });
  _triggerDownload(blob, name + '.geojson');
  toast(t('toastGeoJSONDownload'));
});

// ==========================================
// SHAPEFILE EXPORT
// ==========================================
exportShpBtn.addEventListener('click', function () {
  if (!state.taskMapFC) { toast(t('toastGenerateFirst'), true); return; }
  try {
    const name = exportNameInput.value || _defaultName('taskmap');
    const blob = buildShapefileZip(state.taskMapFC, name);
    _triggerDownload(blob, name + '.zip');
    toast(t('toastShpDownload'));
  } catch (err) {
    console.error(err);
    toast(tf('toastExportError', err.message), true);
  }
});

// ==========================================
// CSV EXPORT
// ==========================================
const exportCsvBtn = document.querySelector('#export-csv-btn');
if (exportCsvBtn) {
  exportCsvBtn.addEventListener('click', function () {
    if (!state.taskMapFC) { toast(t('toastGenerateFirst'), true); return; }
    const name = exportNameInput.value || _defaultName('taskmap');
    const csv = buildCSV(state.taskMapFC);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    _triggerDownload(blob, name + '.csv');
    toast(t('toastCSVDownload'));
  });
}

// ==========================================
// ISOXML EXPORT
// ==========================================
const exportIsoxmlBtn = document.querySelector('#export-isoxml-btn');
if (exportIsoxmlBtn) {
  exportIsoxmlBtn.addEventListener('click', function () {
    if (!state.taskMapFC) { toast(t('toastGenerateFirst'), true); return; }
    showLoading(t('loadingISOXML'));
    setTimeout(function () {
      try {
        const name = exportNameInput.value || _defaultName('taskdata');
        const blob = buildISOXMLZip(state.taskMapFC, name, state.unit);
        hideLoading();
        if (!blob) return;
        _triggerDownload(blob, name + '_TASKDATA.zip');
        toast(t('toastISOXMLDownload'));
      } catch (err) {
        hideLoading();
        console.error(err);
        toast(tf('toastISOXMLError', err.message), true);
      }
    }, 50);
  });
}

// ==========================================
// PDF EXPORT — Map screenshot + legend + logo
//
// Uses a custom pane-based canvas compositor instead of
// html2canvas, because html2canvas does NOT reliably handle
// Leaflet's z-index pane stacking (tilePane → ndviPane →
// overlayPane).  The new approach captures each Leaflet pane
// separately and composites them in the correct visual order.
// ==========================================

// ── Image loader (CORS-aware) ──
function _loadImage(src) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    // Data URIs (NDVI overlay, SVG) do NOT need CORS
    if (src.indexOf('data:') !== 0) img.crossOrigin = 'anonymous';
    img.onload = function () { resolve(img); };
    img.onerror = reject;
    img.src = src;
  });
}

// ── Read the CSS transform offset from a pane (translate3d dx, dy) ──
function _getPaneOffset(paneEl) {
  var dx = 0, dy = 0;
  if (!paneEl) return { dx: dx, dy: dy };
  var tr = window.getComputedStyle(paneEl).transform;
  if (tr && tr !== 'none') {
    var m = tr.match(/matrix\(([^)]+)\)/);
    if (m) {
      var parts = m[1].split(',').map(parseFloat);
      dx = parts[4] || 0;
      dy = parts[5] || 0;
    }
  }
  return { dx: dx, dy: dy };
}

// ── Render Leaflet vector paths (SVG) onto the canvas ──
//
// Leaflet renders vector layers as SVG <path> elements inside a pane.
// The SVG element sits inside overlayPane (or ndviPane), which is a
// child of mapPane.  The map container has position (mapRect.left,
// mapRect.top).  The mapPane has a CSS transform for the pan offset.
//
// The SVG's viewBox + internal CSS transform (set by the SVG renderer)
// are designed so that a path at SVG coordinate (x, y) corresponds to
// container-pixel (x, y).  The total screen position is therefore:
//   screenX = mapRect.left + mapPaneTransformX + paneTransformX + x
//
// Since the tile images are positioned using getBoundingClientRect()
// (which includes ALL ancestor transforms), their canvas position is:
//   tileScreenX - mapRect.left = mapPaneTransformX + paneTransformX + tileSVGCoordX
//
// This function reads BOTH the mapPane and pane CSS transforms to
// compute the correct offset for path coordinates.
function _renderPanePaths(ctx, paneName) {
  var pane = map.getPane(paneName);
  if (!pane) return;
  var svgEl = pane.querySelector('svg');
  if (!svgEl) return;

  // Collect all paths
  var elements = svgEl.querySelectorAll('path');

  // Compute the cumulative CSS transform offset from mapPane + this pane.
  // The map container's top-left is our canvas origin (0,0).
  var mapPaneEl = map.getPane('mapPane');
  var mapOff = _getPaneOffset(mapPaneEl);
  var paneOff = _getPaneOffset(pane);
  var totalDx = mapOff.dx + paneOff.dx;
  var totalDy = mapOff.dy + paneOff.dy;

  for (var ei = 0; ei < elements.length; ei++) {
    var el = elements[ei];
    var d = el.getAttribute('d');
    if (!d) continue;

    // Skip the selection-path (blue selection outline)
    if (el.classList && el.classList.contains('selection-path')) continue;

    var path;
    try { path = new Path2D(d); } catch (e) { continue; }

    ctx.save();
    ctx.translate(totalDx, totalDy);

    // ── Fill ──
    var fill = el.getAttribute('fill');
    if (fill && fill !== 'none') {
      ctx.fillStyle = fill;
      var fillOpacity = el.getAttribute('fill-opacity');
      if (fillOpacity !== null) ctx.globalAlpha = parseFloat(fillOpacity);
      ctx.fill(path);
      ctx.globalAlpha = 1;
    }

    // ── Stroke ──
    var stroke = el.getAttribute('stroke');
    if (stroke && stroke !== 'none') {
      ctx.strokeStyle = stroke;
      var sw = el.getAttribute('stroke-width');
      ctx.lineWidth = sw ? parseFloat(sw) : 1;
      var so = el.getAttribute('stroke-opacity');
      if (so !== null) ctx.globalAlpha = parseFloat(so);
      var da = el.getAttribute('stroke-dasharray');
      if (da) ctx.setLineDash(da.split(',').map(parseFloat));
      ctx.stroke(path);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }
}

// ── Capture each Leaflet pane at the correct z-order ──
//
// Leaflet organises layers in stacked <div> panes:
//   tilePane     z-index 200   — basemap tiles
//   ndviPane     z-index 399   — NDVI / VI image overlay + contour path
//   overlayPane  z-index 400   — vector layers (BRP parcels, grid, selection)
//
// This function composites them by rendering each pane's DOM
// content onto a single canvas — guaranteeing the correct order.
async function _captureMapToCanvas(map, scale) {
  var container = map.getContainer();
  var mapRect   = container.getBoundingClientRect();
  var size      = map.getSize();

  var canvas = document.createElement('canvas');
  canvas.width  = size.x * scale;
  canvas.height = size.y * scale;
  var ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  // Helper: bounding rect of `el` relative to the map container
  function _elRect(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left - mapRect.left, y: r.top - mapRect.top, w: r.width, h: r.height };
  }

  // ── Render all <img> elements inside a pane ──
  async function _renderPaneImages(paneName) {
    var pane = map.getPane(paneName);
    if (!pane) return;
    var imgs = pane.querySelectorAll('img');
    var tasks = [];
    for (var ii = 0; ii < imgs.length; ii++) {
      var img = imgs[ii];
      if (!img.complete || img.naturalWidth === 0) continue;
      var src = img.currentSrc || img.src;
      if (!src) continue;
      var pos = _elRect(img);
      if (pos.w === 0 || pos.h === 0) continue;
      tasks.push(
        (function (s, p) {
          return _loadImage(s).then(function (loaded) {
            ctx.drawImage(loaded, p.x, p.y, p.w, p.h);
          });
        })(src, pos).catch(function () { /* skip CORS failures */ })
      );
    }
    await Promise.all(tasks);
  }

  // Compose layers from bottom to top:
  await _renderPaneImages('tilePane');    // Basemap tiles     (z 200)
  await _renderPaneImages('ndviPane');    // NDVI / VI overlay  (z 399)
  // Vector paths found in the ndviPane (contour line with pane:'ndviPane')
  _renderPanePaths(ctx, 'ndviPane');
  // Vector paths in the overlayPane (BRP, grid, selection)  (z 400)
  _renderPanePaths(ctx, 'overlayPane');

  return canvas;
}

const exportPdfBtn = document.querySelector('#export-pdf-btn');
if (exportPdfBtn) {
  exportPdfBtn.addEventListener('click', async function () {
    if (!state.taskMapFC) { toast(t('toastGenerateFirst'), true); return; }

    try {
      showLoading(t('loadingPDF'));
      await new Promise(function (r) { setTimeout(r, 100); });

      var name = exportNameInput.value || _defaultName('taskmap');
      var savedCenter = map.getCenter();
      var savedZoom   = map.getZoom();

      // ── Centreer de kaart op het veld ──
      try {
        if (state.selectedParcels && state.selectedParcels.length > 0) {
          var fieldBounds = L.geoJSON({
            type: 'FeatureCollection', features: state.selectedParcels
          }).getBounds();
          map.fitBounds(fieldBounds, { padding: [30, 30] });
        } else if (state.georaster) {
          map.fitBounds(getGeoBounds(), { padding: [30, 30] });
        }
      } catch (e) { /* ignore fitBounds errors */ }

      map.invalidateSize();

      // ── Wacht tot alle tegels geladen zijn ──
      await new Promise(function (resolve) {
        var tilePane = map._panes && map._panes.tilePane;
        if (!tilePane) { resolve(); return; }
        var unloaded = tilePane.querySelectorAll('.leaflet-tile:not(.leaflet-tile-loaded)');
        if (unloaded.length === 0) { resolve(); return; }
        var done = false;
        map.once('tileload', function () { if (!done) { done = true; resolve(); } });
        setTimeout(function () { if (!done) { done = true; resolve(); } }, 5000);
      });
      await new Promise(function (r) { setTimeout(r, 400); });

      // ── Capture the map — pane by pane, correct z-order ──
      var canvas = await _captureMapToCanvas(map, 2);

      // ── Restore map view ──
      try { map.setView(savedCenter, savedZoom); } catch (e) {}

      // ── Convert canvas to JPEG data-URI ──
      var imgData = await new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          var reader = new FileReader();
          reader.onload = function () { resolve(reader.result); };
          reader.readAsDataURL(blob);
        }, 'image/jpeg', 0.92);
      });

      var imgW = canvas.width;
      var imgH = canvas.height;

      // ── Build PDF (A4 landscape) ──
      // Guard: ensure jsPDF library is loaded
      if (!window.jspdf || !window.jspdf.jsPDF) {
        throw new Error('jsPDF library niet geladen — controleer je internetverbinding');
      }
      var pdf = new window.jspdf.jsPDF('landscape', 'mm', 'a4');
      var pageW = pdf.internal.pageSize.getWidth();   // 297 mm
      var pageH = pdf.internal.pageSize.getHeight();  // 210 mm
      var margin = 14;
      var usableW = pageW - 2 * margin;               // 269 mm

      // ── Header with vector logo ──
      var curY = margin;
      var logoX = margin;
      var logoSize = 9; // mm

      // Draw a simple stylised crop/leaf logo (no emojis — jsPDF lacks emoji support)
      function drawLogo(x, y, size) {
        var s = size;
        pdf.setDrawColor(0);
        pdf.setLineWidth(0.6);
        // Stem
        pdf.line(x + s * 0.45, y + s, x + s * 0.45, y + s * 0.2);
        // Leaf shape (two ellipses)
        pdf.setFillColor(46, 125, 50); // var(--primary)
        pdf.ellipse(x + s * 0.32, y + s * 0.45, s * 0.22, s * 0.35, 'F');
        pdf.setFillColor(76, 175, 80); // var(--primary-light)
        pdf.ellipse(x + s * 0.68, y + s * 0.48, s * 0.20, s * 0.30, 'F');
        // Veins
        pdf.setDrawColor(255, 255, 255);
        pdf.setLineWidth(0.2);
        pdf.line(x + s * 0.45, y + s * 0.3, x + s * 0.20, y + s * 0.15);
        pdf.line(x + s * 0.45, y + s * 0.4, x + s * 0.70, y + s * 0.25);
      }
      drawLogo(logoX, curY, logoSize);

      pdf.setFontSize(16);
      pdf.setFont(undefined, 'bold');
      pdf.setTextColor(0);
      pdf.text(t('pdfTitle'), logoX + logoSize + 3, curY + 6);

      pdf.setFontSize(9);
      pdf.setFont(undefined, 'normal');
      pdf.setTextColor(100);
      pdf.text(t('pdfSubtitle'), logoX + logoSize + 3, curY + 11);

      // Subtitle — right-aligned: date
      var dateStr = new Date().toLocaleDateString('nl-NL');
      pdf.text(dateStr, pageW - margin, curY + 6, { align: 'right' });

      // Separator line
      curY += 16;
      pdf.setDrawColor(200);
      pdf.setLineWidth(0.3);
      pdf.line(margin, curY, pageW - margin, curY);

      // ── Map image (full width) + Legend (onder de kaart) ──
      var mapTopY = curY + 4;
      var footerY = pageH - margin - 2;
      var mapRatio = imgW / imgH;
      var classes = state.classes || [];
      var rowH = 4; // mm per legend row

      // Calculate legend height
      var legendH = 0;
      if (classes.length > 0) {
        legendH = 10 + classes.length * rowH; // title + header + rows
      }

      // Map: full width, shrink if needed to leave room for legend + footer
      var gap = 5;
      var mapW = usableW;
      var mapH = mapW / mapRatio;
      var availableH = footerY - mapTopY;
      var neededH = mapH + gap + legendH;
      if (neededH > availableH) {
        var newMapH = availableH - gap - legendH;
        if (newMapH > 30) { // minimum 30mm map height
          mapH = newMapH;
          mapW = mapH * mapRatio;
        }
      }
      var mapX = margin;

      // Border around map
      pdf.setDrawColor(160);
      pdf.setLineWidth(0.4);
      pdf.rect(mapX - 0.5, mapTopY - 0.5, mapW + 1, mapH + 1);

      // Insert map screenshot
      pdf.addImage(imgData, 'JPEG', mapX, mapTopY, mapW, mapH);

      // ── Legend area (onder de kaart) ──
      if (classes.length > 0) {
        var legY = mapTopY + mapH + gap;

        pdf.setFontSize(7.5);
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(60);
        pdf.text(t('pdfLegend'), margin, legY);
        legY += 4.5;

        // Kolommen over volledige breedte
        var cols = [
          { x: margin, w: 6 },                           // kleurstaal
          { x: margin + 8, w: 70 },                      // klassenaam
          { x: margin + 82, w: 60 },                     // NDVI-bereik
          { x: margin + 146, w: 50 },                    // dosering
          { x: margin + 200, w: usableW - 200 },         // eenheid
        ];
        var headerRow = ['', t('clsName'), t('pdfNDVIRange'), t('pdfRate'), t('clsDose')];

        // Table header
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(120);
        pdf.setFontSize(6);
        headerRow.forEach(function (h, i) {
          if (i === 0) return;
          pdf.text(h, cols[i].x, legY, { maxWidth: cols[i].w });
        });
        legY += 3;

        // Table rows (all classes fit since we're at full width)
        classes.forEach(function (cls, idx) {
          var y = legY + idx * rowH;

          // Color swatch (gevulde rechthoek)
          pdf.setFillColor(
            parseInt(cls.color.slice(1, 3), 16),
            parseInt(cls.color.slice(3, 5), 16),
            parseInt(cls.color.slice(5, 7), 16)
          );
          pdf.rect(cols[0].x, y - 1, 5, rowH - 1, 'F');
          pdf.setDrawColor(180);
          pdf.setLineWidth(0.1);
          pdf.rect(cols[0].x, y - 1, 5, rowH - 1, 'S');

          // Class data
          pdf.setFont(undefined, 'normal');
          pdf.setTextColor(30);
          pdf.setFontSize(6);
          pdf.text(cls.name, cols[1].x, y + 1.5, { maxWidth: cols[1].w });
          pdf.text(cls.min.toFixed(2) + ' - ' + cls.max.toFixed(2), cols[2].x, y + 1.5, { maxWidth: cols[2].w });
          pdf.text(String(cls.rate), cols[3].x, y + 1.5, { maxWidth: cols[3].w });
          pdf.text(state.unit || 'kg/ha', cols[4].x, y + 1.5, { maxWidth: cols[4].w });
        });
      }

      // ── Footer metadata ──
      var footerParts = [];
      if (state.sourceFileName) {
        footerParts.push(state.sourceFileName.replace(/\.[^.]+$/, ''));
      }
      footerParts.push(state.gridSize + ' m grid');
      if (state.taskMapFC && state.taskMapFC.features) {
        footerParts.push(state.taskMapFC.features.length + ' cellen');
        var totalArea = 0;
        state.taskMapFC.features.forEach(function (f) {
          if (f.geometry) { try { totalArea += turf.area(f); } catch (e) {} }
        });
        footerParts.push((totalArea / 10000).toFixed(1) + ' ha');
      }
      footerParts.push(state.unit || 'kg/ha');

      pdf.setFontSize(6);
      pdf.setFont(undefined, 'normal');
      pdf.setTextColor(140);
      pdf.text(footerParts.join('  \u00B7  '), margin, pageH - margin - 1, { maxWidth: usableW });

      // ── Save ──
      pdf.save(name + '.pdf');
      hideLoading();
      toast(t('toastPDFExport'));
    } catch (err) {
      hideLoading();
      console.error(err);
      // Restore map view
      if (typeof savedCenter !== 'undefined') try { map.setView(savedCenter, savedZoom); } catch (e) {}
      toast(tf('toastPdfExportError', err.message), true);
    }
  });
}

// ==========================================
// PARCEL EXPORT — Shapefile & GeoPackage
// ==========================================
/** Export selected parcels as Shapefile (.zip) */
const exportParcelsShpBtn = document.querySelector('#export-parcels-shp-btn');
if (exportParcelsShpBtn) {
  exportParcelsShpBtn.addEventListener('click', function () {
    if (!state.selectedParcels || state.selectedParcels.length === 0) {
      toast(t('toastSelectParcels'), true); return;
    }
    try {
      const fc = { type: 'FeatureCollection', features: state.selectedParcels };
      const name = exportNameInput.value || _defaultName('parcels');
      const blob = buildParcelShapefileZip(fc, name);
      _triggerDownload(blob, name + '.zip');
      toast(t('toastParcelShpDownload'));
    } catch (err) {
      console.error(err);
      toast(tf('toastExportError', err.message), true);
    }
  });
}

/** Export selected parcels as GeoPackage (.gpkg) */
const exportParcelsGpkgBtn = document.querySelector('#export-parcels-gpkg-btn');
if (exportParcelsGpkgBtn) {
  exportParcelsGpkgBtn.addEventListener('click', function () {
    if (!state.selectedParcels || state.selectedParcels.length === 0) {
      toast(t('toastSelectParcels'), true); return;
    }
    try {
      const fc = { type: 'FeatureCollection', features: state.selectedParcels };
      const name = exportNameInput.value || _defaultName('parcels');
      const blob = buildParcelGeoPackage(fc);
      if (blob) {
        _triggerDownload(blob, name + '.gpkg');
        toast(t('toastParcelGpkgDownload'));
      }
    } catch (err) {
      console.error(err);
      toast(tf('toastExportError', err.message), true);
    }
  });
}

// ==========================================
// HELPERS
// ==========================================
function _triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Generates a dynamic default filename based on the source raster name,
 * today's date and the export type suffix.
 * Example: "odm_orthophoto_20250602_taskmap"
 * @param {string} suffix - e.g. 'taskmap', 'taskdata', 'parcels'
 * @returns {string}
 */
function _defaultName(suffix) {
  const src = state.sourceFileName || 'ndvi';
  const base = src.replace(/\.[^.]+$/, '');
  const d = new Date();
  const ds = d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0');
  return base + '_' + ds + '_' + suffix;
}

/** Update the export-name input placeholder when the source file changes */
function _updateExportNameInput() {
  if (exportNameInput) {
    const name = _defaultName('taskmap');
    exportNameInput.placeholder = name;
    // Only overwrite if user hasn't manually edited it
    if (!exportNameInput.dataset.userEdited) {
      exportNameInput.value = name;
    }
  }
}
// Watch for source file changes and refresh the export name
let _srcWatcher = setInterval(function () {
  if (state.sourceFileName) {
    _updateExportNameInput();
    clearInterval(_srcWatcher);
  }
}, 200);
// Also run immediately
_updateExportNameInput();
// Track user edits — don't overwrite once manually changed
exportNameInput.addEventListener('input', function () {
  exportNameInput.dataset.userEdited = 'true';
});
exportNameInput.addEventListener('blur', function () {
  if (!this.value.trim()) {
    delete this.dataset.userEdited;
    _updateExportNameInput();
  }
});

/**
 * Builds a UTF-8 BOM-prefixed CSV string from the task-map FeatureCollection.
 * Each row represents one grid cell with its NDVI, class, dosage, unit and
 * area in m².
 * @param {object} geojson - GeoJSON FeatureCollection (state.taskMapFC).
 * @returns {string} CSV text.
 */
function buildCSV(geojson) {
  const rows = ['\uFEFFcell_id,ndvi,class,dose,unit,area_m2'];
  geojson.features.forEach(function (f, i) {
    const p = f.properties;
    const area = Math.round(turf.area(f));
    rows.push([
      i + 1, p.ndvi,
      '"' + String(p['class'] || '').replace(/"/g, '""') + '"',
      p.dose,
      '"' + String(p.unit || '').replace(/"/g, '""') + '"',
      area
    ].join(','));
  });
  return rows.join('\r\n');
}

/**
 * Ray-casting point-in-polygon test used to rasterise treatment zones
 * into the ISOXML binary grid.
 * @param {number} lon     - Test point longitude.
 * @param {number} lat     - Test point latitude.
 * @param {object} feature - GeoJSON Feature (Polygon or MultiPolygon).
 * @returns {boolean}
 */
function _pip(lon, lat, feature) {
  const coords = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (let p = 0; p < coords.length; p++) {
    const ring = coords[p][0];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi))
        inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

/**
 * Builds an ISO 11783-10 (ISOXML) TaskData archive compatible with ISOBUS
 * task controllers.  GridType 1 (1 byte/cell = treatment zone code).
 */
function buildISOXMLZip(geojson, name, unit) {
  const enc = new TextEncoder();
  const rateMap = {}, tznList = [];
  let code = 1;
  geojson.features.forEach(function (f) {
    const key = String(f.properties.dose) + '|' + f.properties['class'];
    if (!rateMap[key]) {
      rateMap[key] = code++;
      tznList.push({ code: rateMap[key], rate: f.properties.dose, label: f.properties['class'] });
    }
  });
  const allBbox = turf.bbox(geojson);
  const lonMin0 = allBbox[0], latMin0 = allBbox[1], lonMax0 = allBbox[2], latMax0 = allBbox[3];
  const avgLat = (latMin0 + latMax0) / 2;
  const cellLatDeg = state.gridSize / 111320;
  const cellLonDeg = state.gridSize / (111320 * Math.cos(avgLat * Math.PI / 180));
  let lonMin = lonMin0 - cellLonDeg * 0.5, latMin = latMin0 - cellLatDeg * 0.5;
  let lonMax = lonMax0 + cellLonDeg * 0.5, latMax = latMax0 + cellLatDeg * 0.5;
  const numCols = Math.max(1, Math.ceil((lonMax - lonMin) / cellLonDeg));
  const numRows = Math.max(1, Math.ceil((latMax - latMin) / cellLatDeg));
  if (numCols * numRows > 500000) { toast(t('toastGridTooLarge'), true); return null; }

  const gridBin = new Uint8Array(numRows * numCols);
  geojson.features.forEach(function (f) {
    const key = String(f.properties.dose) + '|' + f.properties['class'];
    const tznCode = rateMap[key];
    const fb = turf.bbox(f);
    const c0 = Math.max(0, Math.floor((fb[0] - lonMin) / cellLonDeg));
    const c1 = Math.min(numCols - 1, Math.ceil((fb[2] - lonMin) / cellLonDeg));
    const r0 = Math.max(0, Math.floor((latMax - fb[3]) / cellLatDeg));
    const r1 = Math.min(numRows - 1, Math.ceil((latMax - fb[1]) / cellLatDeg));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (gridBin[r * numCols + c]) continue;
        if (_pip(lonMin + (c + 0.5) * cellLonDeg, latMax - (r + 0.5) * cellLatDeg, f))
          gridBin[r * numCols + c] = tznCode;
      }
    }
  });

  // Flip vertically: ISO 11783-10 row 0 = southernmost
  const gridBinFinal = new Uint8Array(numRows * numCols);
  for (let r = 0; r < numRows; r++)
    for (let c = 0; c < numCols; c++)
      gridBinFinal[(numRows - 1 - r) * numCols + c] = gridBin[r * numCols + c];

  const fileLength = numRows * numCols;
  const ddiMap = {
    'kg/ha':     '0005',
    'g/ha':      '0005',
    't/ha':      '0005',
    'L/ha':      '0001',
    'mL/ha':     '0001',
    'm\u00b3/ha': '0022',
    'kg/m\u00b2': '0023',
    'L/m\u00b2':  '0022',
    'zaden/ha':  '0015',
    'stuks/ha':  '0016',
    'doses/ha':  '0019',
    'eenheden/ha':'0007',
  };
  const ddi = ddiMap[unit] || '0007';
  const tznXML = tznList.map(tz =>
    '    <TZN A="' + tz.code + '" B="' + escapeXml(tz.label) + '">\n' +
    '      <PDV A="' + ddi + '" B="' + Math.round(tz.rate * 100) + '" C="PDT1"/>\n    </TZN>'
  ).join('\n');
  const xmlStr =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<ISO11783_TaskData VersionMajor="4" VersionMinor="0"\n' +
    '  ManagementSoftwareManufacturer="DiLab"\n' +
    '  ManagementSoftwareName="NDVI Taakkaart Generator"\n' +
    '  DataTransferOrigin="1">\n' +
    '  <PDT A="PDT1" B="' + escapeXml(name) + '" C="1"/>\n' +
    '  <TSK A="TSK1" B="' + escapeXml(name) + '" G="1">\n' +
    '    <TZN A="0" B="Outside field"/>\n' +
    tznXML + '\n' +
    '    <GRD A="' + latMin.toFixed(8) + '" B="' + lonMin.toFixed(8) + '"\n' +
    '         C="' + cellLatDeg.toFixed(8) + '" D="' + cellLonDeg.toFixed(8) + '"\n' +
    '         E="' + numCols + '" F="' + numRows + '" G="GRD00001"\n' +
    '         H="' + fileLength + '" I="1"/>\n' +
    '  </TSK>\n</ISO11783_TaskData>\n';
  return _buildZipBlob([
    { name: 'TASKDATA/TASKDATA.XML', data: enc.encode(xmlStr) },
    { name: 'TASKDATA/GRD00001.BIN', data: gridBinFinal },
  ]);
}

// ==========================================
// ZIP BUILDER (no external dependency)
// ==========================================
/**
 * Pre-computed CRC-32 lookup table (polynomial 0xEDB88320, reflected bit order).
 * Used by the ZIP local/central headers which require CRC-32 of each entry.
 */
const _CRC_TABLE = (function () {
  const t2 = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t2[i] = c;
  }
  return t2;
})();

/**
 * Computes CRC-32 over a Uint8Array using the pre-computed lookup table.
 * @param {Uint8Array} u8
 * @returns {number} Unsigned 32-bit CRC value.
 */
function _crc32(u8) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) crc = _CRC_TABLE[(crc ^ u8[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Concatenates an array of Uint8Arrays into a single Uint8Array.
 * @param {Uint8Array[]} arrs
 * @returns {Uint8Array}
 */
function _concat(arrs) {
  let n = 0; arrs.forEach(a => { n += a.length; });
  const out = new Uint8Array(n); let o = 0;
  arrs.forEach(a => { out.set(a, o); o += a.length; });
  return out;
}

/**
 * Assembles a valid ZIP archive Blob from an array of file entries.
 * Uses store compression (method 0) — no DEFLATE required.
 * @param {{ name: string, data: Uint8Array }[]} files
 * @returns {Blob} application/zip Blob.
 */
function _buildZipBlob(files) {
  const enc = new TextEncoder();
  const lparts = [], cparts = [];
  let off = 0;
  files.forEach(function (f) {
    const nm = enc.encode(f.name), crc = _crc32(f.data), sz = f.data.length;
    const lh = new DataView(new ArrayBuffer(30 + nm.length));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true);
    lh.setUint16(26, nm.length, true);
    new Uint8Array(lh.buffer).set(nm, 30);
    const cd = new DataView(new ArrayBuffer(46 + nm.length));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, sz, true); cd.setUint32(24, sz, true);
    cd.setUint16(28, nm.length, true); cd.setUint32(42, off, true);
    new Uint8Array(cd.buffer).set(nm, 46);
    lparts.push(new Uint8Array(lh.buffer), f.data);
    cparts.push(new Uint8Array(cd.buffer));
    off += 30 + nm.length + sz;
  });
  const cdOffset = off;
  const cdSz = cparts.reduce((s, p) => s + p.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSz, true); eocd.setUint32(16, cdOffset, true);
  return new Blob([_concat([...lparts, ...cparts, new Uint8Array(eocd.buffer)])], { type: 'application/zip' });
}

// ==========================================
// SHAPEFILE WRITER (pure JS, ESRI Shapefile 1998 spec)
// ==========================================
/**
 * Builds a Shapefile archive (.zip with .shp / .shx / .dbf / .prj)
 * from a GeoJSON FeatureCollection, entirely in pure JavaScript.
 *
 * Only Polygon and MultiPolygon geometries are included (shape type 5).
 * The .prj file declares WGS84 geographic coordinates (EPSG:4326).
 * The .dbf encodes NDVI, class name, dosage rate and unit.
 *
 * @param {object} geojson - GeoJSON FeatureCollection.
 * @param {string} name    - Base filename (without extension).
 * @returns {Blob} ZIP Blob containing the four shapefile components.
 */
/**
 * Ensures polygon ring orientation matches the Shapefile specification:
 * exterior rings clockwise (CW), interior rings (holes) counter-clockwise (CCW).
 * GeoJSON (RFC 7946) uses the opposite — exterior CCW, holes CW — so rings
 * are reversed where needed.
 * @param {number[][][]} rings - Array of rings (each ring is an array of [lon,lat]).
 * @returns {number[][][]} Rings with corrected orientation.
 */
function _fixRingOrientation(rings) {
  return rings.map(function (ring, idx) {
    // Signed area (2×) via trapezoid formula: positive → CW in geographic coords
    let s = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      s += (ring[j][0] - ring[i][0]) * (ring[i][1] + ring[j][1]);
    }
    const isCW = s > 0;
    if (idx === 0) {
      // exterior ring — Shapefile expects CW
      return isCW ? ring : ring.slice().reverse();
    } else {
      // hole — Shapefile expects CCW
      return isCW ? ring.slice().reverse() : ring;
    }
  });
}

function buildShapefileZip(geojson, name) {
  const feats = geojson.features.filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));

  const recs = feats.map(function (f) {
    const rings = _fixRingOrientation(
      f.geometry.type === 'Polygon'
        ? f.geometry.coordinates
        : f.geometry.coordinates.reduce((a, p) => a.concat(p), [])
    );
    const nPts = rings.reduce((s, r) => s + r.length, 0);
    const ab = new ArrayBuffer(44 + 4 * rings.length + 16 * nPts);
    const v = new DataView(ab);
    let o = 0;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    rings.forEach(r => r.forEach(p => {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }));
    v.setInt32(o, 5, true); o += 4;
    v.setFloat64(o, x0, true); o += 8; v.setFloat64(o, y0, true); o += 8;
    v.setFloat64(o, x1, true); o += 8; v.setFloat64(o, y1, true); o += 8;
    v.setInt32(o, rings.length, true); o += 4;
    v.setInt32(o, nPts, true); o += 4;
    let pi = 0;
    rings.forEach(r => { v.setInt32(o, pi, true); o += 4; pi += r.length; });
    rings.forEach(r => r.forEach(p => { v.setFloat64(o, p[0], true); o += 8; v.setFloat64(o, p[1], true); o += 8; }));
    return { u8: new Uint8Array(ab), x0, y0, x1, y1 };
  });

  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  recs.forEach(r => {
    if (r.x0 < bx0) bx0 = r.x0; if (r.y0 < by0) by0 = r.y0;
    if (r.x1 > bx1) bx1 = r.x1; if (r.y1 > by1) by1 = r.y1;
  });
  if (!isFinite(bx0)) { bx0 = 0; by0 = 0; bx1 = 0; by1 = 0; }

  function makeHdr(words) {
    const ab = new ArrayBuffer(100), v = new DataView(ab);
    v.setInt32(0, 9994, false); v.setInt32(24, words, false);
    v.setInt32(28, 1000, true); v.setInt32(32, 5, true);
    v.setFloat64(36, bx0, true); v.setFloat64(44, by0, true);
    v.setFloat64(52, bx1, true); v.setFloat64(60, by1, true);
    return new Uint8Array(ab);
  }

  const shpBodyLen = recs.reduce((s, r) => s + 8 + r.u8.length, 0);
  const shpBody = new ArrayBuffer(shpBodyLen), shpV = new DataView(shpBody);
  let shpPos = 0;
  const shxBody = new ArrayBuffer(recs.length * 8), shxV = new DataView(shxBody);
  recs.forEach(function (r, i) {
    const offW = (100 + shpPos) / 2;
    shxV.setInt32(i * 8,     offW,             false);
    shxV.setInt32(i * 8 + 4, r.u8.length / 2, false);
    shpV.setInt32(shpPos,     i + 1,            false);
    shpV.setInt32(shpPos + 4, r.u8.length / 2, false);
    shpPos += 8;
    new Uint8Array(shpBody, shpPos).set(r.u8);
    shpPos += r.u8.length;
  });
  const shpFile = _concat([makeHdr((100 + shpBodyLen) / 2), new Uint8Array(shpBody)]);
  const shxFile = _concat([makeHdr((100 + recs.length * 8) / 2), new Uint8Array(shxBody)]);

  const flds = [
    { n: 'NDVI',   t: 'N', l: 12, d: 4 },
    { n: 'CLASS',  t: 'C', l: 30, d: 0 },
    { n: 'DOSE',   t: 'N', l: 12, d: 2 },
    { n: 'UNIT',   t: 'C', l: 10, d: 0 },
  ];
  const recSz = 1 + flds.reduce((s, f) => s + f.l, 0);
  const hdrSz = 33 + flds.length * 32;
  const dbfBuf = new ArrayBuffer(hdrSz + feats.length * recSz + 1);
  const dbfV = new DataView(dbfBuf), dbfU = new Uint8Array(dbfBuf);
  const now = new Date();
  dbfV.setUint8(0, 3);
  dbfV.setUint8(1, now.getFullYear() - 1900);
  dbfV.setUint8(2, now.getMonth() + 1);
  dbfV.setUint8(3, now.getDate());
  dbfV.setUint32(4, feats.length, true);
  dbfV.setUint16(8, hdrSz, true);
  dbfV.setUint16(10, recSz, true);
  flds.forEach(function (f, fi) {
    const base = 32 + fi * 32;
    for (let j = 0; j < f.n.length; j++) dbfU[base + j] = f.n.charCodeAt(j);
    dbfU[base + 11] = f.t.charCodeAt(0);
    dbfU[base + 16] = f.l;
    dbfU[base + 17] = f.d;
  });
  dbfU[32 + flds.length * 32] = 0x0D;
  feats.forEach(function (feat, fi) {
    const p = feat.properties || {}, base = hdrSz + fi * recSz;
    dbfU[base] = 0x20;
    let col = 1;
    flds.forEach(function (f) {
      const key = f.n.toLowerCase();
      const raw = p[key] != null ? String(p[key]) : '';
      const val = f.t === 'N' ? raw.padStart(f.l).substring(0, f.l) : raw.padEnd(f.l).substring(0, f.l);
      for (let j = 0; j < f.l; j++) dbfU[base + col + j] = val.charCodeAt(j) || 0x20;
      col += f.l;
    });
  });
  dbfU[hdrSz + feats.length * recSz] = 0x1A;

  const prj = new TextEncoder().encode('GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]');
  const cpg = new TextEncoder().encode('UTF-8');

  return _buildZipBlob([
    { name: name + '.shp', data: shpFile },
    { name: name + '.shx', data: shxFile },
    { name: name + '.dbf', data: new Uint8Array(dbfBuf) },
    { name: name + '.prj', data: prj },
    { name: name + '.cpg', data: cpg },
  ]);
}

// ==========================================
// NDVI GEOTIFF EXPORT (clipped to selected parcels)
// (nu in stap 6 — Exporteren)
// ==========================================
const exportNdviTifBtn = document.querySelector('#export-ndvi-tif-step6-btn');
if (exportNdviTifBtn) {
  exportNdviTifBtn.addEventListener('click', function () {
    if (!state.ndviGrid || !state.georaster) { toast(t('toastNoNDVI'), true); return; }
    if (!state.selectedParcels || state.selectedParcels.length === 0) {
      toast(t('toastNdviTiffNeedParcels'), true); return;
    }
    try {
      // Base the filename on the original source raster, not the task-map
      // export name — this download is a clip of the *input*, not the task map.
      const src = state.sourceFileName || 'ndvi';
      const baseName = src.replace(/\.(tiff?|tif)$/i, '');
      const name = baseName + '_NDVI_clip';
      const blob = buildClippedNdviGeoTIFF(state.selectedParcels);
      if (!blob) { toast(t('toastNdviTiffEmpty'), true); return; }
      _triggerDownload(blob, name + '.tif');
      toast(t('toastNdviTiffDownload'));
    } catch (err) {
      console.error(err);
      toast(tf('toastExportError', err.message), true);
    }
  });
}

/**
 * Builds a single-band Float32 GeoTIFF Blob containing the computed NDVI
 * values clipped to the union of the supplied parcel geometries.
 *
 * The output is cropped to the parcel bounding box (intersected with the
 * raster bounds) and uses the raster CRS (`state.geotiffEPSG`).  Pixels
 * outside the parcels or without a valid NDVI value are written as NaN
 * with `GDAL_NODATA="nan"` for downstream tooling.
 *
 * @param {object[]} parcels - Selected GeoJSON parcel features (EPSG:4326).
 * @returns {Blob|null} GeoTIFF blob, or null when no pixels intersect.
 */
function buildClippedNdviGeoTIFF(parcels) {
  const gr = state.georaster;
  const ndviGrid = state.ndviGrid;
  const epsg = state.geotiffEPSG || 'EPSG:4326';
  const w = gr.width, h = gr.height;
  const pxW = gr.pixelWidth;
  const pxH = Math.abs(gr.pixelHeight);

  // Reproject each parcel ring to the raster CRS and find pixel-space bbox.
  const ringsPx = [];                 // rings in pixel coordinates (col, row)
  let pc0 = Infinity, pr0 = Infinity, pc1 = -Infinity, pr1 = -Infinity;
  parcels.forEach(function (parcel) {
    const geom = parcel.geometry || parcel;
    let polyRings = [];
    if (geom.type === 'Polygon') polyRings = geom.coordinates;
    else if (geom.type === 'MultiPolygon') {
      for (let mp = 0; mp < geom.coordinates.length; mp++) {
        polyRings = polyRings.concat(geom.coordinates[mp]);
      }
    } else return;
    polyRings.forEach(function (ring) {
      if (!ring || ring.length < 3) return;
      const pxRing = [];
      for (let i = 0; i < ring.length; i++) {
        let cx = ring[i][0], cy = ring[i][1];
        if (epsg && epsg !== 'EPSG:4326') {
          try { const pp = proj4('EPSG:4326', epsg, [cx, cy]); cx = pp[0]; cy = pp[1]; }
          catch (e) { return; }
        }
        const pc = (cx - gr.xmin) / pxW;
        const pr = (gr.ymax - cy) / pxH;
        pxRing.push([pc, pr]);
        if (pc < pc0) pc0 = pc; if (pc > pc1) pc1 = pc;
        if (pr < pr0) pr0 = pr; if (pr > pr1) pr1 = pr;
      }
      if (pxRing.length >= 3) ringsPx.push(pxRing);
    });
  });
  if (ringsPx.length === 0) return null;

  // Clamp the crop window to the raster grid and align to integer pixels.
  const col0 = Math.max(0, Math.floor(pc0));
  const row0 = Math.max(0, Math.floor(pr0));
  const col1 = Math.min(w, Math.ceil(pc1));
  const row1 = Math.min(h, Math.ceil(pr1));
  const cropW = col1 - col0;
  const cropH = row1 - row0;
  if (cropW <= 0 || cropH <= 0) return null;

  // Rasterise the parcel mask via an off-screen canvas, offset by (col0,row0).
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = cropW; maskCanvas.height = cropH;
  const mctx = maskCanvas.getContext('2d');
  mctx.fillStyle = '#fff';
  mctx.beginPath();
  ringsPx.forEach(function (ring) {
    for (let i = 0; i < ring.length; i++) {
      const x = ring[i][0] - col0, y = ring[i][1] - row0;
      if (i === 0) mctx.moveTo(x, y); else mctx.lineTo(x, y);
    }
    mctx.closePath();
  });
  mctx.fill('evenodd');
  const mdata = mctx.getImageData(0, 0, cropW, cropH).data;

  // Compose the float32 pixel buffer.
  const out = new Float32Array(cropW * cropH);
  let kept = 0;
  for (let r = 0; r < cropH; r++) {
    const srcRow = (row0 + r) * w;
    const dstRow = r * cropW;
    for (let c = 0; c < cropW; c++) {
      const insideMask = mdata[((r * cropW) + c) << 2] > 0;
      const v = insideMask ? ndviGrid[srcRow + (col0 + c)] : NaN;
      if (!isNaN(v)) { out[dstRow + c] = v; kept++; }
      else            { out[dstRow + c] = NaN; }
    }
  }
  if (kept === 0) return null;

  // Compute the geo-anchor for the cropped raster (top-left corner).
  const originX = gr.xmin + col0 * pxW;
  const originY = gr.ymax - row0 * pxH;

  // Resolve EPSG code & projection type.
  const epsgNum = parseInt(String(epsg).replace(/^EPSG:/i, ''), 10) || 4326;
  const isGeographic = epsgNum === 4326 || epsgNum === 4979;

  return _buildSingleBandFloat32GeoTIFF(
    out, cropW, cropH, originX, originY, pxW, pxH, epsgNum, isGeographic
  );
}

/**
 * Writes a minimal little-endian GeoTIFF with a single Float32 strip,
 * the GeoKey directory needed for georeferencing, and GDAL_NODATA="nan".
 * No external library dependency.
 *
 * @param {Float32Array} pixels       - Row-major pixel buffer, length w*h.
 * @param {number} width
 * @param {number} height
 * @param {number} originX            - Map X of the top-left pixel corner.
 * @param {number} originY            - Map Y of the top-left pixel corner.
 * @param {number} pxW                - Pixel width in map units.
 * @param {number} pxH                - Pixel height in map units (positive).
 * @param {number} epsgNum            - EPSG numeric code.
 * @param {boolean} isGeographic      - True for geographic CRS (EPSG:4326 …).
 * @returns {Blob} GeoTIFF (image/tiff) blob.
 */
function _buildSingleBandFloat32GeoTIFF(pixels, width, height, originX, originY, pxW, pxH, epsgNum, isGeographic) {
  // Tag layout (sorted by tag id, required by TIFF spec).
  // Tag types: 3=SHORT, 4=LONG, 12=DOUBLE, 2=ASCII
  const NUM_ENTRIES = 15;
  const IFD_OFFSET = 8;
  const IFD_SIZE   = 2 + NUM_ENTRIES * 12 + 4;      // header bytes
  let extOff = IFD_OFFSET + IFD_SIZE;

  // External (non-inline) values, allocated sequentially after the IFD.
  const modelPixelScale = new Float64Array([pxW, pxH, 0]);
  const modelTiepoint   = new Float64Array([0, 0, 0, originX, originY, 0]);

  // GeoKeyDirectory: header (4 SHORTs) + 3 keys × 4 SHORTs = 16 SHORTs.
  const geoKeyCount = 3;
  const geoKeyDir = new Uint16Array(4 + geoKeyCount * 4);
  geoKeyDir[0] = 1; geoKeyDir[1] = 1; geoKeyDir[2] = 0; geoKeyDir[3] = geoKeyCount;
  // GTModelTypeGeoKey (1024) — 1=Projected, 2=Geographic.
  geoKeyDir[4] = 1024; geoKeyDir[5] = 0; geoKeyDir[6] = 1; geoKeyDir[7] = isGeographic ? 2 : 1;
  // GTRasterTypeGeoKey (1025) — 1=PixelIsArea.
  geoKeyDir[8] = 1025; geoKeyDir[9] = 0; geoKeyDir[10] = 1; geoKeyDir[11] = 1;
  // EPSG key.
  geoKeyDir[12] = isGeographic ? 2048 : 3072;
  geoKeyDir[13] = 0; geoKeyDir[14] = 1; geoKeyDir[15] = epsgNum;

  const mpsOffset = extOff;                            extOff += modelPixelScale.byteLength;
  const mtpOffset = extOff;                            extOff += modelTiepoint.byteLength;
  const gkdOffset = extOff;                            extOff += geoKeyDir.byteLength;
  // GDAL_NODATA "nan\0" — 4 ASCII bytes — fits inline, no external storage.
  // Pad external area to even byte boundary before pixel data (TIFF best practice).
  if (extOff & 1) extOff += 1;
  const pixelOffset = extOff;
  const pixelBytes  = width * height * 4;
  const totalBytes  = pixelOffset + pixelBytes;

  const buf = new ArrayBuffer(totalBytes);
  const dv  = new DataView(buf);
  const u8  = new Uint8Array(buf);
  const LE  = true;

  // ── TIFF header ───────────────────────────────────────────────
  dv.setUint16(0, 0x4949, LE);  // "II" little-endian
  dv.setUint16(2, 42, LE);      // TIFF magic
  dv.setUint32(4, IFD_OFFSET, LE);

  // ── IFD ───────────────────────────────────────────────────────
  dv.setUint16(IFD_OFFSET, NUM_ENTRIES, LE);
  let p = IFD_OFFSET + 2;
  function writeEntry(tag, type, count, valueWriter) {
    dv.setUint16(p, tag, LE);
    dv.setUint16(p + 2, type, LE);
    dv.setUint32(p + 4, count, LE);
    valueWriter(p + 8);
    p += 12;
  }
  function inlineShort(value) { return function (off) { dv.setUint16(off, value, LE); dv.setUint16(off + 2, 0, LE); }; }
  function inlineLong(value)  { return function (off) { dv.setUint32(off, value, LE); }; }
  function inlineOffset(off2) { return function (off) { dv.setUint32(off, off2, LE); }; }

  writeEntry(256, 4, 1, inlineLong(width));            // ImageWidth
  writeEntry(257, 4, 1, inlineLong(height));           // ImageLength
  writeEntry(258, 3, 1, inlineShort(32));              // BitsPerSample
  writeEntry(259, 3, 1, inlineShort(1));               // Compression — none
  writeEntry(262, 3, 1, inlineShort(1));               // PhotometricInterpretation — BlackIsZero
  writeEntry(273, 4, 1, inlineLong(pixelOffset));      // StripOffsets
  writeEntry(277, 3, 1, inlineShort(1));               // SamplesPerPixel
  writeEntry(278, 4, 1, inlineLong(height));           // RowsPerStrip
  writeEntry(279, 4, 1, inlineLong(pixelBytes));       // StripByteCounts
  writeEntry(284, 3, 1, inlineShort(1));               // PlanarConfiguration — chunky
  writeEntry(339, 3, 1, inlineShort(3));               // SampleFormat — IEEE float
  writeEntry(33550, 12, 3, inlineOffset(mpsOffset));   // ModelPixelScale
  writeEntry(33922, 12, 6, inlineOffset(mtpOffset));   // ModelTiepoint
  writeEntry(34735, 3, geoKeyDir.length, inlineOffset(gkdOffset)); // GeoKeyDirectory
  // GDAL_NODATA — "nan\0", 4 ASCII bytes, inline.
  writeEntry(42113, 2, 4, function (off) {
    u8[off]     = 0x6E;   // 'n'
    u8[off + 1] = 0x61;   // 'a'
    u8[off + 2] = 0x6E;   // 'n'
    u8[off + 3] = 0x00;
  });

  // Next IFD offset = 0 (no further images).
  dv.setUint32(p, 0, LE);

  // ── External value blocks ─────────────────────────────────────
  for (let i = 0; i < modelPixelScale.length; i++) {
    dv.setFloat64(mpsOffset + i * 8, modelPixelScale[i], LE);
  }
  for (let i = 0; i < modelTiepoint.length; i++) {
    dv.setFloat64(mtpOffset + i * 8, modelTiepoint[i], LE);
  }
  for (let i = 0; i < geoKeyDir.length; i++) {
    dv.setUint16(gkdOffset + i * 2, geoKeyDir[i], LE);
  }

  // ── Pixel data (row-major Float32) ────────────────────────────
  for (let i = 0; i < pixels.length; i++) {
    dv.setFloat32(pixelOffset + i * 4, pixels[i], LE);
  }

  return new Blob([buf], { type: 'image/tiff' });
}

// ==========================================
// PARCEL SHAPEFILE EXPORT (wrapper with parcel attributes)
// ==========================================
/**
 * Builds a shapefile ZIP from a parcel FeatureCollection with relevant
 * BRP attributes (gewas, gewasgroep, oppervlakte) in the DBF table.
 * Delegates geometry/shx/dbf/prj encoding to buildShapefileZip.
 * @param {object} geojson - GeoJSON FeatureCollection of parcels.
 * @param {string} name    - Base filename.
 * @returns {Blob} ZIP blob with .shp/.shx/.dbf/.prj
 */
function buildParcelShapefileZip(geojson, name) {
  const feats = geojson.features.filter(function (f) {
    return f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
  });

  const recs = feats.map(function (f) {
    const rings = _fixRingOrientation(
      f.geometry.type === 'Polygon'
        ? f.geometry.coordinates
        : f.geometry.coordinates.reduce(function (a, p) { return a.concat(p); }, [])
    );
    const nPts = rings.reduce(function (s, r) { return s + r.length; }, 0);
    const ab = new ArrayBuffer(44 + 4 * rings.length + 16 * nPts);
    const v = new DataView(ab);
    let o = 0;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
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

  var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  recs.forEach(function (r) {
    if (r.x0 < bx0) bx0 = r.x0; if (r.y0 < by0) by0 = r.y0;
    if (r.x1 > bx1) bx1 = r.x1; if (r.y1 > by1) by1 = r.y1;
  });
  if (!isFinite(bx0)) { bx0 = 0; by0 = 0; bx1 = 0; by1 = 0; }

  function makeHdr(words) {
    var ab2 = new ArrayBuffer(100), v2 = new DataView(ab2);
    v2.setInt32(0, 9994, false); v2.setInt32(24, words, false);
    v2.setInt32(28, 1000, true); v2.setInt32(32, 5, true);
    v2.setFloat64(36, bx0, true); v2.setFloat64(44, by0, true);
    v2.setFloat64(52, bx1, true); v2.setFloat64(60, by1, true);
    return new Uint8Array(ab2);
  }

  var shpBodyLen = recs.reduce(function (s, r) { return s + 8 + r.u8.length; }, 0);
  var shpBody = new ArrayBuffer(shpBodyLen), shpV = new DataView(shpBody);
  var shpPos = 0;
  var shxBody = new ArrayBuffer(recs.length * 8), shxV = new DataView(shxBody);
  recs.forEach(function (r, i) {
    var offW = (100 + shpPos) / 2;
    shxV.setInt32(i * 8, offW, false);
    shxV.setInt32(i * 8 + 4, r.u8.length / 2, false);
    shpV.setInt32(shpPos, i + 1, false);
    shpV.setInt32(shpPos + 4, r.u8.length / 2, false);
    shpPos += 8;
    new Uint8Array(shpBody, shpPos).set(r.u8);
    shpPos += r.u8.length;
  });
  var shpFile = _concat([makeHdr((100 + shpBodyLen) / 2), new Uint8Array(shpBody)]);
  var shxFile = _concat([makeHdr((100 + recs.length * 8) / 2), new Uint8Array(shxBody)]);

  // Parcel-specific DBF fields: crop name, crop group, area (ha), category
  var flds = [
    { n: 'CROP',     t: 'C', l: 60, d: 0 },
    { n: 'CROP_GRP', t: 'C', l: 40, d: 0 },
    { n: 'AREA_HA',  t: 'N', l: 12, d: 3 },
    { n: 'CATEGORY', t: 'C', l: 20, d: 0 },
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
    var p = feat.properties || {};
    var base2 = hdrSz + fi * recSz;
    dbfU[base2] = 0x20;
    var crop  = p.crop || p.CROP || p.GWS_GEWAS || '';
    var group = p.crop_group || p.crop_grp || p.CROP_GRP || '';
    var areaHa = 0;
    try { areaHa = turf.area(feat) / 10000; } catch (e) {}
    var cat  = p.category || p.CATEGORY || '';
    var vals = [
      String(crop).padEnd(60).substring(0, 60),
      String(group).padEnd(40).substring(0, 40),
      areaHa.toFixed(3).padStart(12).substring(0, 12),
      String(cat).padEnd(20).substring(0, 20),
    ];
    var col = 1;
    vals.forEach(function (val) {
      for (var j = 0; j < val.length; j++) dbfU[base2 + col + j] = val.charCodeAt(j) || 0x20;
      col += val.length;
    });
  });
  dbfU[hdrSz + feats.length * recSz] = 0x1A;

  var prj = new TextEncoder().encode('GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]');
  var cpg = new TextEncoder().encode('UTF-8');

  return _buildZipBlob([
    { name: name + '.shp', data: shpFile },
    { name: name + '.shx', data: shxFile },
    { name: name + '.dbf', data: new Uint8Array(dbfBuf) },
    { name: name + '.prj', data: prj },
    { name: name + '.cpg', data: cpg },
  ]);
}

// ==========================================
// GEOPACKAGE EXPORT (pure JS, minimal SQLite writer)
// ==========================================
/**
 * Builds a valid OGC GeoPackage (.gpkg) from a parcel FeatureCollection.
 *
 * GeoPackage is a SQLite container with specific metadata tables.
 * This implementation writes the SQLite database binary directly,
 * requiring no external dependencies.
 *
 * @param {object} geojson - GeoJSON FeatureCollection (EPSG:4326 polygons).
 * @returns {Blob|null} GeoPackage blob, or null on error.
 */
function buildParcelGeoPackage(geojson) {
  var feats = geojson.features.filter(function (f) {
    return f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
  });
  if (feats.length === 0) return null;

  // ---------------------------------------------------------------
  // 1. WKB geometry encoder (little-endian, Polygon/MultiPolygon)
  // ---------------------------------------------------------------
  function encodeWKB(geom) {
    var LE = true;
    if (geom.type === 'Polygon') {
      var rings = geom.coordinates;
      var totalPts = 0;
      rings.forEach(function (r) { totalPts += r.length; });
      var buf = new ArrayBuffer(9 + rings.length * 4 + totalPts * 16);
      var v = new DataView(buf);
      var o = 0;
      v.setUint8(o, 1); o += 1;           // byte order LE
      v.setUint32(o, 3, LE); o += 4;       // Polygon = 3
      v.setUint32(o, rings.length, LE); o += 4;
      rings.forEach(function (r) {
        v.setUint32(o, r.length, LE); o += 4;
        r.forEach(function (p) {
          v.setFloat64(o, p[0], LE); o += 8;
          v.setFloat64(o, p[1], LE); o += 8;
        });
      });
      return new Uint8Array(buf);
    }
    // MultiPolygon
    var polys = geom.coordinates;
    var totalSize = 9; // byteOrder + type + numPolys
    polys.forEach(function (poly) {
      totalSize += 9; // byteOrder + type + numRings
      poly.forEach(function (ring) {
        totalSize += 4 + ring.length * 16;
      });
    });
    var buf2 = new ArrayBuffer(totalSize);
    var v2 = new DataView(buf2);
    var o2 = 0;
    v2.setUint8(o2, 1); o2 += 1;
    v2.setUint32(o2, 6, LE); o2 += 4;      // MultiPolygon = 6
    v2.setUint32(o2, polys.length, LE); o2 += 4;
    polys.forEach(function (poly) {
      v2.setUint8(o2, 1); o2 += 1;
      v2.setUint32(o2, 3, LE); o2 += 4;    // Polygon = 3
      v2.setUint32(o2, poly.length, LE); o2 += 4;
      poly.forEach(function (ring) {
        v2.setUint32(o2, ring.length, LE); o2 += 4;
        ring.forEach(function (p) {
          v2.setFloat64(o2, p[0], LE); o2 += 8;
          v2.setFloat64(o2, p[1], LE); o2 += 8;
        });
      });
    });
    return new Uint8Array(buf2);
  }

  // ---------------------------------------------------------------
  // 2. GeoPackage Geometry Binary (GPB) encoder
  //    Header (8 bytes) + WKB geometry
  // ---------------------------------------------------------------
  function encodeGPB(geom) {
    var wkb = encodeWKB(geom);
    var LE = true;
    var flags = 1; // bit 0 = 1 (LE byte order)
    var buf = new ArrayBuffer(8 + wkb.length);
    var v = new DataView(buf);
    v.setUint8(0, 0x47);                // 'G'
    v.setUint8(1, 0x50);                // 'P'
    v.setUint8(2, 0x00);                // version 0
    v.setUint8(3, flags);               // flags
    v.setUint32(4, 4326, LE);           // SRS ID (WGS84)
    new Uint8Array(buf, 8).set(wkb);
    return new Uint8Array(buf);
  }

  // ---------------------------------------------------------------
  // 3. SQLite varint encoder (returns [bytes, length])
  // ---------------------------------------------------------------
  function sqliteVarint(val) {
    if (val < 0) val = 0;
    var bytes = [];
    // Encode in 7-bit groups, MSB first
    var temp = val;
    var n = 0;
    while (temp > 0x7F) { n++; temp >>>= 7; }
    n++; // at least 1 byte
    for (var i = n - 1; i >= 0; i--) {
      var shift = i * 7;
      var b = (val >>> shift) & 0x7F;
      if (i > 0) b |= 0x80;
      bytes.push(b);
    }
    if (bytes.length === 0) bytes.push(0);
    return bytes;
  }

  // ---------------------------------------------------------------
  // 4. SQLite record builder
  //    Returns { header: Uint8Array, data: Uint8Array }
  // ---------------------------------------------------------------
  function buildRecord(values) {
    var types = [];
    var dataParts = [];
    var enc = new TextEncoder();

    values.forEach(function (v) {
      if (v === null || v === undefined) {
        types.push(0); // NULL
        dataParts.push(new Uint8Array(0));
      } else if (typeof v === 'number') {
        // SQLite serial types: 0=NULL, 1=int8, 2=int16, 4=int32, 6=int64, 7=float64, 8=0, 9=1
        if (v === 0) { types.push(8); dataParts.push(new Uint8Array(0)); }
        else if (v === 1) { types.push(9); dataParts.push(new Uint8Array(0)); }
        else if (Number.isInteger(v) && v >= -2147483648 && v <= 2147483647) {
          types.push(4); // 32-bit signed integer
          var buf = new ArrayBuffer(4);
          (new DataView(buf)).setInt32(0, v, false); // big-endian for SQLite
          dataParts.push(new Uint8Array(buf));
        } else if (Number.isInteger(v)) {
          types.push(6); // 64-bit signed integer
          var buf = new ArrayBuffer(8);
          (new DataView(buf)).setInt32(0, 0, false); // high 32 bits
          (new DataView(buf)).setInt32(4, v, false); // low 32 bits (big-endian)
          dataParts.push(new Uint8Array(buf));
        } else {
          types.push(7); // IEEE float 64-bit
          var buf = new ArrayBuffer(8);
          (new DataView(buf)).setFloat64(0, v, false); // big-endian for SQLite
          dataParts.push(new Uint8Array(buf));
        }
      } else if (typeof v === 'string') {
        var u8 = enc.encode(v);
        types.push(u8.length * 2 + 13); // text type
        dataParts.push(u8);
      } else if (v instanceof Uint8Array) {
        types.push(v.length * 2 + 12); // blob type
        dataParts.push(v);
      } else {
        // fallback: stringify
        var s = String(v);
        var u8b = enc.encode(s);
        types.push(u8b.length * 2 + 13);
        dataParts.push(u8b);
      }
    });

    // Serialise header (type varints)
    var hdrBytes = [];
    var hdrSize = 0;
    types.forEach(function (t) {
      var tv = sqliteVarint(t);
      hdrBytes = hdrBytes.concat(tv);
      hdrSize += tv.length;
    });
    // Prepend overall header size as varint
    var totalHdrSize = hdrSize;
    var sizeVar = sqliteVarint(totalHdrSize + 1); // +1 for the size field itself
    var allHdr = sizeVar.concat(hdrBytes);

    var hdrU8 = new Uint8Array(allHdr);
    // Concatenate data parts
    var totalDataLen = 0;
    dataParts.forEach(function (d) { totalDataLen += d.length; });
    var dataU8 = new Uint8Array(totalDataLen);
    var off = 0;
    dataParts.forEach(function (d) { dataU8.set(d, off); off += d.length; });

    return { header: hdrU8, data: dataU8, hdrLen: hdrU8.length, dataLen: totalDataLen };
  }

  // ---------------------------------------------------------------
  // 5. SQLite b-tree leaf page builder
  //    Creates a table leaf b-tree page (type 0x0D)
  // ---------------------------------------------------------------
  function buildLeafPage(pageSize, cells, rightMostPage) {
    // Pre-compute cell payloads
    var payloads = cells.map(function (c) {
      return { rowId: c.rowId, record: buildRecord(c.values) };
    });

    // Calculate cell sizes and offsets (from end of page)
    var cellSizes = payloads.map(function (p) {
      var rowIdV = sqliteVarint(p.rowId);
      var totalPayload = rowIdV.length + p.record.hdrLen + p.record.dataLen;
      var plV = sqliteVarint(totalPayload);
      return plV.length + totalPayload; // full cell size (payload varint + payload)
    });

    // Page header: 8 bytes
    // [pageType:1][firstFreeblock:2][cellCount:2][contentOffset:2][fragFreeBytes:1]
    var headerSize = 8;
    var cellPtrSize = cells.length * 2;
    var contentStart = headerSize + cellPtrSize;

    // Compute content offsets (cells placed from end of page inward)
    var cellOffsets = [];
    var curOff = pageSize;
    for (var i = 0; i < cells.length; i++) {
      curOff -= cellSizes[i];
      cellOffsets.push(curOff);
    }

    // Build the page
    var page = new Uint8Array(pageSize);
    var v = new DataView(page.buffer);

    // Page header — SQLite uses big-endian for multi-byte integers
    v.setUint8(0, 0x0D); // table leaf
    v.setUint16(1, 0, false); // first freeblock
    v.setUint16(3, cells.length, false); // cell count
    // content area offset (first byte after the cell pointer array)
    v.setUint16(5, contentStart, false);
    v.setUint8(7, 0); // frag free bytes

    // Cell pointer array (offsets from start of page, big-endian)
    for (var ci = 0; ci < cells.length; ci++) {
      v.setUint16(headerSize + ci * 2, cellOffsets[ci], false);
    }

    // Write cell content
    for (var ci2 = 0; ci2 < cells.length; ci2++) {
      var p = payloads[ci2];
      var off = cellOffsets[ci2];
      // Payload length varint
      var rowIdV = sqliteVarint(p.rowId);
      var payloadLen = rowIdV.length + p.record.hdrLen + p.record.dataLen;
      var plV = sqliteVarint(payloadLen);
      plV.forEach(function (b) { page[off++] = b; });
      // Row ID varint
      rowIdV.forEach(function (b) { page[off++] = b; });
      // Record header
      p.record.header.forEach(function (b) { page[off++] = b; });
      // Record data
      p.record.data.forEach(function (b) { page[off++] = b; });
    }

    return page;
  }

  // ---------------------------------------------------------------
  // 6. SQLite header
  // ---------------------------------------------------------------
  function buildSQLiteHeader(numPages) {
    var PAGE_SIZE = 1024;
    var hdr = new Uint8Array(100);
    var enc2 = new TextEncoder();
    // Magic string
    var magic = enc2.encode('SQLite format 3\0');
    for (var i = 0; i < 16; i++) hdr[i] = magic[i];
    // Page size
    hdr[16] = (PAGE_SIZE >>> 8) & 0xFF;
    hdr[17] = PAGE_SIZE & 0xFF;
    // Write version: 1, Read version: 1
    hdr[18] = 1; hdr[19] = 1;
    // Reserved
    hdr[20] = 0x00;
    // Max embedded payload, min embedded, leaf payload
    hdr[21] = 0x40; hdr[22] = 0x20; hdr[23] = 0x20;
    // File change counter
    hdr[24] = 0; hdr[25] = 0; hdr[26] = 0; hdr[27] = 0;
    // Database size in pages
    hdr[28] = (numPages >>> 24) & 0xFF;
    hdr[29] = (numPages >>> 16) & 0xFF;
    hdr[30] = (numPages >>> 8) & 0xFF;
    hdr[31] = numPages & 0xFF;
    // Freelist stuff
    for (var fi = 32; fi < 52; fi++) hdr[fi] = 0;
    // Schema cookie
    hdr[52] = 0; hdr[53] = 0; hdr[54] = 0; hdr[55] = 1;
    // Schema format
    hdr[56] = 0; hdr[57] = 0; hdr[58] = 0; hdr[59] = 4;
    // Default page cache
    hdr[60] = 0; hdr[61] = 0; hdr[62] = 0; hdr[63] = 0;
    // Largest root b-tree page
    hdr[64] = 0; hdr[65] = 0; hdr[66] = 0; hdr[67] = 0;
    // Text encoding: 1 = UTF-8
    hdr[68] = 0; hdr[69] = 0; hdr[70] = 0; hdr[71] = 1;
    // User version
    hdr[72] = 0; hdr[73] = 0; hdr[74] = 0; hdr[75] = 0;
    // Incremental vacuum
    hdr[76] = 0; hdr[77] = 0; hdr[78] = 0; hdr[79] = 0;
    // Application ID
    hdr[80] = 0; hdr[81] = 0; hdr[82] = 0; hdr[83] = 0;
    // Reserved 20 bytes
    for (var ri = 84; ri < 92; ri++) hdr[ri] = 0;
    for (var ri2 = 92; ri2 < 96; ri2++) hdr[ri2] = 0;
    // Version valid for
    hdr[92] = 0; hdr[93] = 0; hdr[94] = 0; hdr[95] = 1;
    // SQLite version
    hdr[96] = 0; hdr[97] = 0; hdr[98] = 0; hdr[99] = 0x01; // 3.x.y.z encoded

    return hdr;
  }

  // ---------------------------------------------------------------
  // 7. Assemble the GeoPackage
  // ---------------------------------------------------------------
  var PAGE_SIZE = 1024;
  var enc = new TextEncoder();

  // Metadata: SRS row (EPSG:4326)
  var srsName = 'WGS 84 geodetic';
  var srsOrg = 'EPSG';
  var srsCode = '4326';
  var srsDef = 'GEOGCS["WGS 84",DATUM["World Geodetic System 1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]';
  var srsAuth = 'EPSG';

  // ── Page assignment ──
  // Page 1: header (100 bytes) + sqlite_master leaf page
  // Page 2: gpkg_spatial_ref_sys leaf page (1 row)
  // Page 3: gpkg_contents leaf page (1 row)
  // Page 4: gpkg_geometry_columns leaf page (1 row)
  // Pages 5+: percelen feature data

  // We need to estimate how many pages for features.
  // Each feature row: geometry (~varies) + attributes (~200 bytes)
  // Average feature ~500 bytes WKB + 200 bytes attributes + overhead
  // ~750 bytes per feature, ~1 feature per page at 1024 page size
  var nFeatPages = Math.max(1, Math.ceil(feats.length * 0.75));
  // But actually features might share pages, so let's be smarter.
  // Pre-compute row sizes for feature table
  var featRowSizes = [];
  var totalFeatPayload = 0;
  feats.forEach(function (f, fi) {
    var geomBlob = encodeGPB(f.geometry);
    var props = f.properties || {};
    var crop = props.crop || props.CROP || props.gewas || props.GWS_GEWAS || '';
    var group = props.crop_group || props.crop_grp || props.CROP_GRP || props.gewasgroep || '';
    var cat = props.category || props.CATEGORY || props.categorie || '';
    var areaHa = 0;
    try { areaHa = turf.area(f) / 10000; } catch (e) {}
    // row values: fid (int), geom (blob), crop (text), crop_grp (text), area_ha (real), category (text)
    var r = buildRecord([fi + 1, geomBlob, crop, group, areaHa, cat]);
    var rowIdV = sqliteVarint(fi + 1);
    var payload = rowIdV.length + r.hdrLen + r.dataLen;
    var plV = sqliteVarint(payload);
    var cellSize = plV.length + payload;
    featRowSizes.push(cellSize);
    totalFeatPayload += cellSize + 2; // +2 for cell pointer
  });

  // Pages for features: each page has 8 bytes header + cell ptrs + content
  var PAGE_DATA = PAGE_SIZE - 8; // available data per page (rough)
  var pagesUsed = 0;
  var currentPageData = 0;
  featRowSizes.forEach(function (sz) {
    // cell needs: 2 bytes pointer + content
    var need = 2 + sz;
    if (currentPageData + need > PAGE_DATA) {
      pagesUsed++;
      currentPageData = need;
    } else {
      currentPageData += need;
    }
  });
  if (currentPageData > 0) pagesUsed++;
  nFeatPages = Math.max(1, pagesUsed);

  var totalPages = 4 + nFeatPages; // pages 1-4 for metadata, rest for features

  // ── Build pages ──

  // Page 1: Header (100) + sqlite_master leaf page (PAGE_SIZE - 100 = 924 bytes for content)
  // sqlite_master columns: type, name, tbl_name, rootpage, sql
  // Rows: gpkg_contents, gpkg_spatial_ref_sys, gpkg_geometry_columns, percelen
  var masterCells = [
    {
      rowId: 1,
      values: ['table', 'gpkg_contents', 'gpkg_contents', 3,
        'CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY,data_type TEXT NOT NULL,identifier TEXT unique,description TEXT DEFAULT \'\',last_change DATETIME NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')),min_x DOUBLE,min_y DOUBLE,max_x DOUBLE,max_y DOUBLE,srs_id INTEGER,CONSTRAINT fk_gpkg_contents_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id))']
    },
    {
      rowId: 2,
      values: ['table', 'gpkg_spatial_ref_sys', 'gpkg_spatial_ref_sys', 2,
        'CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL,srs_id INTEGER NOT NULL PRIMARY KEY,organization TEXT NOT NULL,organization_coordsys_id INTEGER NOT NULL,definition TEXT NOT NULL,description TEXT)']
    },
    {
      rowId: 3,
      values: ['table', 'gpkg_geometry_columns', 'gpkg_geometry_columns', 4,
        'CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL,column_name TEXT NOT NULL,geometry_type_name TEXT NOT NULL,srs_id INTEGER NOT NULL,z TINYINT NOT NULL,m TINYINT NOT NULL,CONSTRAINT pk_geom_columns PRIMARY KEY (table_name, column_name))']
    },
    {
      rowId: 4,
      values: ['table', 'percelen', 'percelen', 5,
        'CREATE TABLE percelen (fid INTEGER PRIMARY KEY AUTOINCREMENT,geom GEOMETRY NOT NULL,crop TEXT,crop_grp TEXT,area_ha REAL,category TEXT)']
    },
  ];

  // Compute master page cells and content offsets
  var masterPayloads = masterCells.map(function (c) {
    return { rowId: c.rowId, record: buildRecord(c.values) };
  });
  var masterCellSizes = masterPayloads.map(function (p) {
    var rv = sqliteVarint(p.rowId);
    var pl = rv.length + p.record.hdrLen + p.record.dataLen;
    var pv = sqliteVarint(pl);
    return pv.length + pl;
  });

  // Master page: header + cell pointers + content
  var masterPage = new Uint8Array(PAGE_SIZE);
  // Copy header for page 1 (first 100 bytes are SQLite header)
  var sqliteHdr = buildSQLiteHeader(totalPages);
  for (var hi = 0; hi < 100; hi++) masterPage[hi] = sqliteHdr[hi];

  // After the 100-byte DB header, we have the b-tree page header
  // b-tree page header starts at offset 100 — all multi-byte ints are big-endian
  var masterHdrOff = 100;
  var vMaster = new DataView(masterPage.buffer);
  vMaster.setUint8(masterHdrOff, 0x0D); // table leaf
  vMaster.setUint16(masterHdrOff + 1, 0, false); // first freeblock
  vMaster.setUint16(masterHdrOff + 3, masterCells.length, false); // cell count
  var masterPtrOff = masterHdrOff + 8;
  vMaster.setUint16(masterHdrOff + 5, masterPtrOff, false); // content offset (from page start)
  vMaster.setUint8(masterHdrOff + 7, 0); // frag free

  // Compute cell offsets (from end of page inward)
  var masterCellOffsets = [];
  var curMasterOff = PAGE_SIZE;
  for (var mi = 0; mi < masterCells.length; mi++) {
    curMasterOff -= masterCellSizes[mi];
    masterCellOffsets.push(curMasterOff);
  }

  // Write cell pointers (big-endian)
  for (var mpi = 0; mpi < masterCells.length; mpi++) {
    vMaster.setUint16(masterPtrOff + mpi * 2, masterCellOffsets[mpi], false);
  }

  // Write cell content for master page
  for (var mci = 0; mci < masterCells.length; mci++) {
    var p = masterPayloads[mci];
    var off = masterCellOffsets[mci];
    var rowIdV = sqliteVarint(p.rowId);
    var payloadLen = rowIdV.length + p.record.hdrLen + p.record.dataLen;
    var plV = sqliteVarint(payloadLen);
    plV.forEach(function (b) { masterPage[off++] = b; });
    rowIdV.forEach(function (b) { masterPage[off++] = b; });
    p.record.header.forEach(function (b) { masterPage[off++] = b; });
    p.record.data.forEach(function (b) { masterPage[off++] = b; });
  }

  // ── Page 2: gpkg_spatial_ref_sys ──
  var srsPage = buildLeafPage(PAGE_SIZE, [
    { rowId: 1, values: [srsName, 4326, srsOrg, 4326, srsDef, null] },
  ]);

  // ── Page 3: gpkg_contents ──
  var now2 = new Date();
  var isoDate = now2.getUTCFullYear() + '-' +
    String(now2.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(now2.getUTCDate()).padStart(2, '0') + 'T' +
    String(now2.getUTCHours()).padStart(2, '0') + ':' +
    String(now2.getUTCMinutes()).padStart(2, '0') + ':' +
    String(now2.getUTCSeconds()).padStart(2, '0') + 'Z';
  // Compute overall bbox
  var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  feats.forEach(function (f) {
    try {
      var bb = turf.bbox(f);
      if (bb[0] < bx0) bx0 = bb[0]; if (bb[1] < by0) by0 = bb[1];
      if (bb[2] > bx1) bx1 = bb[2]; if (bb[3] > by1) by1 = bb[3];
    } catch (e) {}
  });

  var contentsPage = buildLeafPage(PAGE_SIZE, [
    { rowId: 1, values: ['percelen', 'features', 'percelen', '', isoDate, bx0, by0, bx1, by1, 4326] },
  ]);

  // ── Page 4: gpkg_geometry_columns ──
  var geomColPage = buildLeafPage(PAGE_SIZE, [
    { rowId: 1, values: ['percelen', 'geom', 'GEOMETRY', 4326, 0, 0] },
  ]);

  // ── Pages 5+: percelen feature data ──
  // Group features into pages
  var featPages = [];
  var currentPageCells = [];
  var currentPagePayload = 0;
  feats.forEach(function (f, fi) {
    var geomBlob = encodeGPB(f.geometry);
    var props = f.properties || {};
    var crop = props.crop || props.CROP || props.gewas || props.GWS_GEWAS || '';
    var group = props.crop_group || props.crop_grp || props.CROP_GRP || props.gewasgroep || '';
    var cat = props.category || props.CATEGORY || props.categorie || '';
    var areaHa = 0;
    try { areaHa = turf.area(f) / 10000; } catch (e) {}

    var cellValues = [fi + 1, geomBlob, crop, group, areaHa, cat];
    // Calculate approximate cell size
    var rec = buildRecord(cellValues);
    var rv = sqliteVarint(fi + 1);
    var pl = rv.length + rec.hdrLen + rec.dataLen;
    var pv = sqliteVarint(pl);
    var cellSizeEst = 2 + pv.length + pl; // 2 for cell pointer + content

    if (currentPagePayload + cellSizeEst > (PAGE_SIZE - 8) && currentPageCells.length > 0) {
      featPages.push(currentPageCells);
      currentPageCells = [];
      currentPagePayload = 0;
    }
    currentPageCells.push({ rowId: fi + 1, values: cellValues });
    currentPagePayload += cellSizeEst;
  });
  if (currentPageCells.length > 0) featPages.push(currentPageCells);

  // Build feature pages
  var featPageBuffers = [];
  featPages.forEach(function (pageCells) {
    featPageBuffers.push(buildLeafPage(PAGE_SIZE, pageCells));
  });

  // ── Ensure we have at least nFeatPages pages ──
  while (featPageBuffers.length < nFeatPages) {
    // Empty page
    var emptyPage = new Uint8Array(PAGE_SIZE);
    emptyPage[0] = 0x0D; // table leaf with 0 cells
    featPageBuffers.push(emptyPage);
  }

  // ── Final assembly ──
  var allPages = [masterPage, srsPage, contentsPage, geomColPage].concat(featPageBuffers);
  var totalSize = allPages.length * PAGE_SIZE;
  var finalBuf = new ArrayBuffer(totalSize);
  var finalView = new Uint8Array(finalBuf);
  var outOff = 0;
  allPages.forEach(function (page) {
    finalView.set(page, outOff);
    outOff += page.length;
  });

  // Patch the database size in the header
  var actualPages = allPages.length;
  finalView[28] = (actualPages >>> 24) & 0xFF;
  finalView[29] = (actualPages >>> 16) & 0xFF;
  finalView[30] = (actualPages >>> 8) & 0xFF;
  finalView[31] = actualPages & 0xFF;

  return new Blob([finalBuf], { type: 'application/geopackage+sqlite3' });
}
