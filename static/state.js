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
 * Returns the five default NDVI dosage classes.
 * Called at startup and after a language switch so that class names
 * are always in the active locale.
 * @returns {{ name: string, min: number, max: number, rate: number, color: string }[]}
 */
export function defaultClasses() {
  const { t } = window;
  return [
    { name: t('clsVeryLow'), min: -1.0, max: 0.25, rate: 150, color: '#d32f2f' },
    { name: t('clsLow'),     min: 0.25, max: 0.40, rate: 120, color: '#f57c00' },
    { name: t('clsMid'),     min: 0.40, max: 0.55, rate: 90,  color: '#fdd835' },
    { name: t('clsHigh'),    min: 0.55, max: 0.70, rate: 60,  color: '#66bb6a' },
    { name: t('clsVeryHigh'),min: 0.70, max: 1.00, rate: 30,  color: '#2e7d32' },
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
};
