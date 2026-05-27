/* ===================================================
   state.js — Shared application state & constants

   Single source of truth for all mutable UI and data
   state.  Every module imports `state` by reference;
   mutations are made in-place so all importers see
   the updated value automatically.
   =================================================== */

/** PDOK BRP Gewaspercelen WFS endpoint (OGC WFS 2.0) */
export const BRP_WFS_URL = 'https://service.pdok.nl/rvo/gewaspercelen/wfs/v1_0';

/** Minimum Leaflet zoom level before the BRP layer is requested */
export const MIN_ZOOM_BRP = 14;

/**
 * Returns the seven default NDVI dosage classes using a ColorBrewer
 * RdYlGn 7-class colour scheme for maximum visual contrast.
 * Called at startup and after a language switch so that class names
 * are always in the active locale.
 * @returns {{ name: string, min: number, max: number, rate: number, color: string }[]}
 */
export function defaultClasses() {
  const { t } = window;
  return [
    { name: t('clsVeryLow'), min: -1.0, max: 0.20, rate: 150, color: '#d73027' },
    { name: t('clsLow'),     min: 0.20, max: 0.30, rate: 130, color: '#f46d43' },
    { name: t('clsLowMid'),  min: 0.30, max: 0.45, rate: 110, color: '#fdae61' },
    { name: t('clsMid'),     min: 0.45, max: 0.55, rate: 90,  color: '#fee08b' },
    { name: t('clsHighMid'), min: 0.55, max: 0.65, rate: 70,  color: '#d9ef8b' },
    { name: t('clsHigh'),    min: 0.65, max: 0.80, rate: 50,  color: '#66bd63' },
    { name: t('clsVeryHigh'),min: 0.80, max: 1.00, rate: 30,  color: '#1a9850' },
  ];
}

/**
 * Central mutable state object.
 * All properties start as null/empty and are populated as the user
 * progresses through the wizard steps.
 *
 * Naming conventions:
 *   georaster        — parsed GeoRaster object (georaster-layer-for-leaflet)
 *   ndviGrid         — Float32Array of computed VI values for the full raster
 *   ndviScaleMin/Max — display scale used for colour-ramp stretching
 *   isRGBProxy       — true when the source TIF is a colourised NDVI map
 *                      (e.g. DJI Terra Plant Health), not raw reflectance bands
 *   brpLayerMap      — { [featureId]: { layer, feature } } for fast lookup / re-style
 *   parcelHistoryCache — keyed by centroid string to avoid repeated WFS requests
 */
export const state = {
  georaster: null,
  ndviLayer: null,
  geotiffEPSG: null,
  sourceFileName: null,
  blobUrl: null,
  tiff: null,
  tiffImage: null,
  bandMetas: [],
  isRGBProxy: false,
  brpLayer: null,
  brpGeoJSON: null,
  selectedParcels: [],
  selectedParcelsLayer: null,
  maskLayer: null,
  gridLayer: null,
  taskMapFC: null,
  gridSize: 10,
  gridAngle: 0,
  parcelHistoryCache: {},
  bandRed: null,
  bandGreen: null,
  bandNIR: null,
  bandRedEdge: null,
  selectedVI: 'NDVI',
  classes: [],
  unit: 'kg/ha',
  currentStep: 1,
  isPreCalc: false,
  brpLoading: false,
  ndviHistogramData: null,
  ndviGrid: null,
  ndviScaleMin: null,
  ndviScaleMax: null,
  brpLayerMap: {},
  ahnMode: 'off',

  /** Classification method for auto-classify:
   *  'quantile' — equal area (default)
   *  'equal-interval' — equal width intervals
   *  'std-dev' — standard deviation from the mean
   *  'geometric' — geometric intervals (log-scale)
   *  'pretty' — pretty / nice round-number breaks
   *  'jenks' — natural breaks (Jenks optimisation)
   *  'manual' — no auto-classification
   */
  classificationMethod: 'quantile',

  /** Re-used by renderClassifiedNDVI() after clipNDVIToParcel() */
  ndviMaskData: null,
  ndviMaskParcels: null,
};
