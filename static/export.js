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

import { state } from './state.js';
import { toast, escapeHtml, escapeXml } from './utils.js';

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
  const name = exportNameInput.value || 'taakkaart';
  const exportFC = {
    type: 'FeatureCollection',
    features: state.taskMapFC.features.map(f => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: { ndvi: f.properties.ndvi, klasse: f.properties.klasse, dosering: f.properties.dosering, eenheid: f.properties.eenheid }
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
    const name = exportNameInput.value || 'taakkaart';
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
    const name = exportNameInput.value || 'taakkaart';
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
    const { showLoading, hideLoading } = window._appUtils;
    showLoading(t('loadingISOXML'));
    setTimeout(function () {
      try {
        const name = exportNameInput.value || 'taakkaart';
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
 * Builds a UTF-8 BOM-prefixed CSV string from the task-map FeatureCollection.
 * Each row represents one grid cell with its NDVI, class, dosage, unit and
 * area in m².
 * @param {object} geojson - GeoJSON FeatureCollection (state.taskMapFC).
 * @returns {string} CSV text.
 */
function buildCSV(geojson) {
  const rows = ['\uFEFFcel_id,ndvi,klasse,dosering,eenheid,oppervlakte_m2'];
  geojson.features.forEach(function (f, i) {
    const p = f.properties;
    const area = Math.round(turf.area(f));
    rows.push([
      i + 1, p.ndvi,
      '"' + String(p.klasse || '').replace(/"/g, '""') + '"',
      p.dosering,
      '"' + String(p.eenheid || '').replace(/"/g, '""') + '"',
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
    const key = String(f.properties.dosering) + '|' + f.properties.klasse;
    if (!rateMap[key]) {
      rateMap[key] = code++;
      tznList.push({ code: rateMap[key], rate: f.properties.dosering, label: f.properties.klasse });
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
    const key = String(f.properties.dosering) + '|' + f.properties.klasse;
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
  const ddi = (unit === 'L/ha' || unit === 'm\u00b3/ha') ? '0001' : '0007';
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
    lh.setUint32(0, 0x04034b50, false); lh.setUint16(4, 20, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true);
    lh.setUint16(26, nm.length, true);
    new Uint8Array(lh.buffer).set(nm, 30);
    const cd = new DataView(new ArrayBuffer(46 + nm.length));
    cd.setUint32(0, 0x02014b50, false);
    cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, sz, true); cd.setUint32(24, sz, true);
    cd.setUint16(28, nm.length, true); cd.setUint32(42, off, true);
    new Uint8Array(cd.buffer).set(nm, 46);
    lparts.push(new Uint8Array(lh.buffer), f.data);
    cparts.push(new Uint8Array(cd.buffer));
    off += 30 + nm.length + sz;
  });
  const cdSz = cparts.reduce((s, p) => s + p.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, false);
  eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSz, true); eocd.setUint32(16, off, true);
  return new Blob(lparts.concat(cparts).concat([new Uint8Array(eocd.buffer)]), { type: 'application/zip' });
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
function buildShapefileZip(geojson, name) {
  const feats = geojson.features.filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));

  const recs = feats.map(function (f) {
    const rings = f.geometry.type === 'Polygon'
      ? f.geometry.coordinates
      : f.geometry.coordinates.reduce((a, p) => a.concat(p), []);
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
    { n: 'NDVI',     t: 'N', l: 10, d: 3 },
    { n: 'KLASSE',   t: 'C', l: 30, d: 0 },
    { n: 'DOSERING', t: 'N', l: 10, d: 0 },
    { n: 'EENHEID',  t: 'C', l: 20, d: 0 },
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

  const prj = new TextEncoder().encode('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]');

  return _buildZipBlob([
    { name: name + '.shp', data: shpFile },
    { name: name + '.shx', data: shxFile },
    { name: name + '.dbf', data: new Uint8Array(dbfBuf) },
    { name: name + '.prj', data: prj },
  ]);
}
