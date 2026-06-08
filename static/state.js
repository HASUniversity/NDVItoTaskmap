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
 * Complete list of all vegetation/spectral indices supported by the app.
 * Each entry defines the display name, formula, description, band requirements,
 * and metadata used by the UI and computation engine.
 */
export const VEGETATION_INDICES = [
  // ─── NIR-based indices (need multispectral camera) ───
  { id: 'NDVI', label: 'NDVI', formula: '(NIR − R) / (NIR + R)', desc: 'Normalized Difference Vegetation Index — de standaard voor vegetatiegezondheid en biomassa.', purpose: 'Vegetatiegezondheid, biomassa', range: '-1 tot 1', type: 'nir', clampRange: true, needsNIR: true, needsRed: true },
  { id: 'NDVI_Blue', label: 'NDVI (Blauw)', formula: '(NIR − B) / (NIR + B)', desc: 'NDVI variant die blauw gebruikt i.p.v. rood — nuttig bij atmosferische correctie.', purpose: 'Vegetatie, atmosferisch gecorrigeerd', range: '-1 tot 1', type: 'nir', clampRange: true, needsNIR: true, needsBlue: true },
  { id: 'NDRE', label: 'NDRE', formula: '(NIR − RE) / (NIR + RE)', desc: 'Normalized Difference Red Edge — geschikt voor latere groeistadia en dichte vegetatie.', purpose: 'Late groeistadia, gewasstress', range: '-1 tot 1', type: 'nir', clampRange: true, needsNIR: true, needsRedEdge: true },
  { id: 'GNDVI', label: 'GNDVI', formula: '(NIR − G) / (NIR + G)', desc: 'Green NDVI — meet chlorofyl via groen i.p.v. rood, gevoeliger voor stikstof.', purpose: 'Stikstofopname, chlorofyl', range: '-1 tot 1', type: 'nir', clampRange: true, needsNIR: true, needsGreen: true },
  { id: 'GRVI', label: 'GRVI', formula: 'NIR / G', desc: 'Green-Red Vegetation Index — eenvoudige ratio voor fotosynthesesnelheid.', purpose: 'Fotosynthesesnelheid', range: '0 tot ∞', type: 'nir', clampRange: false, needsNIR: true, needsGreen: true },
  { id: 'NDWI', label: 'NDWI', formula: '(G − NIR) / (G + NIR)', desc: 'Normalized Difference Water Index — detecteert watergehalte in gewassen.', purpose: 'Watergehalte, irrigatie', range: '-1 tot 1', type: 'nir', clampRange: true, needsGreen: true, needsNIR: true },
  { id: 'SAVI', label: 'SAVI', formula: '1.5 × (NIR − R) / (NIR + R + 0.5)', desc: 'Soil-Adjusted Vegetation Index — corrigeert voor bodemreflectie (L=0.5).', purpose: 'Vegetatie in open grond', range: '-1 tot 1', type: 'nir', clampRange: true, needsNIR: true, needsRed: true },
  { id: 'OSAVI', label: 'OSAVI', formula: '(NIR − R) / (NIR + R + 0.16)', desc: 'Optimized Soil-Adjusted Vegetation Index — voor lage vegetatiebedekking.', purpose: 'Lage vegetatie, open grond', range: '-1 tot 1', type: 'nir', clampRange: true, needsNIR: true, needsRed: true },
  { id: 'MNLI', label: 'MNLI', formula: '1.5 × (NIR² − R) / (NIR² + R + 0.5)', desc: 'Modified Non-Linear Index — niet-lineaire bodemcorrectie.', purpose: 'Vegetatie, bodemcorrectie', range: '-1 tot 1', type: 'nir', clampRange: true, needsNIR: true, needsRed: true },
  { id: 'EVI', label: 'EVI', formula: '2.5 × (NIR − R) / (NIR + 6R − 7.5B + 1)', desc: 'Enhanced Vegetation Index — voorkomt verzadiging in dicht bos; gebruikt blauw voor atmosferische correctie.', purpose: 'Dichte vegetatie, bos', range: '-1 tot 1', type: 'nir', clampRange: true, needsNIR: true, needsRed: true, needsBlue: true },
  { id: 'LAI', label: 'LAI', formula: '3.618 × EVI − 0.118', desc: 'Leaf Area Index — schatting van bladoppervlakte per grondoppervlak.', purpose: 'Bladoppervlakte, opbrengst', range: '0 tot 6+', type: 'nir', clampRange: false, needsNIR: true, needsRed: true, needsBlue: true },
  { id: 'LAI_SAVI', label: 'LAI (SAVI)', formula: '3.62 × SAVI + 0.23', desc: 'Leaf Area Index via SAVI — bodemgecorrigeerde LAI-schatting, goed bij open gewassen.', purpose: 'LAI, open gewassen', range: '0 tot 8+', type: 'nir', clampRange: false, needsNIR: true, needsRed: true },
  { id: 'LAI_NDRE', label: 'LAI (NDRE)', formula: '6.41 × NDRE + 0.72', desc: 'Leaf Area Index via NDRE — blijft lineair tot hoge LAI (>6), ideaal voor dichte vegetatie.', purpose: 'LAI, dichte vegetatie', range: '0 tot 8+', type: 'nir', clampRange: false, needsNIR: true, needsRedEdge: true },
  { id: 'ARVI', label: 'ARVI', formula: '(NIR − 2R + B) / (NIR + 2R + B)', desc: 'Atmospherically Resistant Vegetation Index — reduceert atmosferische ruis.', purpose: 'Atmosferisch gecorrigeerd', range: '-1 tot 1', type: 'nir', clampRange: true, needsNIR: true, needsRed: true, needsBlue: true },
  { id: 'ENDVI', label: 'ENDVI', formula: '((NIR + G) − 2B) / ((NIR + G) + 2B)', desc: 'Enhanced NDVI — gebruikt NIR+Groen i.p.v. alleen Rood.', purpose: 'Verbeterde vegetatiedetectie', range: '-1 tot 1', type: 'nir', clampRange: true, needsNIR: true, needsGreen: true, needsBlue: true },
  { id: 'MSR', label: 'MSR', formula: '((NIR/R) − 1) / (√(NIR/R) + 1)', desc: 'Modified Simple Ratio — verbeterde ratio voor vegetatie.', purpose: 'Vegetatie, biomassa', range: '0 tot ∞', type: 'nir', clampRange: false, needsNIR: true, needsRed: true },
  { id: 'RDVI', label: 'RDVI', formula: '(NIR − R) / √(NIR + R)', desc: 'Renormalized Difference Vegetation Index — benadrukt gezonde vegetatie.', purpose: 'Gezonde vegetatie', range: '-1 tot 1', type: 'nir', clampRange: true, needsNIR: true, needsRed: true },
  { id: 'TDVI', label: 'TDVI', formula: '1.5 × ((NIR − R) / √(NIR² + R + 0.5))', desc: 'Transformed Difference Vegetation Index — voor stedelijke vegetatie.', purpose: 'Stedelijke vegetatie', range: '-1 tot 1', type: 'nir', clampRange: true, needsNIR: true, needsRed: true },
  { id: 'BAI', label: 'BAI', formula: '1 / ((0.1−R)² + (0.06−NIR)²)', desc: 'Burn Area Index — detecteert verbrande grond.', purpose: 'Branddetectie', range: '0 tot ∞', type: 'nir', clampRange: false, needsRed: true, needsNIR: true },

  // ─── RGB-based indices (visible light only, no NIR needed) ───
  { id: 'NGRDI', label: 'NGRDI', formula: '(G − R) / (G + R)', desc: 'Normalized Green-Red Difference Index — eenvoudige RGB vegetatie-index.', purpose: 'RGB vegetatie', range: '-1 tot 1', type: 'rgb', clampRange: true, needsGreen: true, needsRed: true },
  { id: 'VARI', label: 'VARI', formula: '(G − R) / (G + R − B)', desc: 'Visible Atmospherically Resistant Index — bestand tegen atmosferische invloeden.', purpose: 'RGB vegetatie, atmosferisch', range: '-1 tot 1', type: 'rgb', clampRange: true, needsGreen: true, needsRed: true, needsBlue: true },
  { id: 'TGI', label: 'TGI', formula: 'G − 0.39R − 0.61B', desc: 'Triangular Greenness Index — benadrukt bladgroen in RGB-beelden.', purpose: 'Bladgroen RGB', range: '−0.2 tot 0.4', type: 'rgb', clampRange: false, needsGreen: true, needsRed: true, needsBlue: true },
  { id: 'MPRI', label: 'MPRI', formula: '(G − R) / (G + R)', desc: 'Modified Photochemical Reflectance Index — zelfde formule als NGRDI.', purpose: 'RGB vegetatie', range: '-1 tot 1', type: 'rgb', clampRange: true, needsGreen: true, needsRed: true },
  { id: 'EXG', label: 'EXG', formula: '2G − R − B', desc: 'Excess Green Index — eenvoudige groen-detectie voor RGB.', purpose: 'Groen-detectie RGB', range: '−1 tot 1', type: 'rgb', clampRange: false, needsGreen: true, needsRed: true, needsBlue: true },
  { id: 'GLI', label: 'GLI', formula: '(2G − R − B) / (2G + R + B)', desc: 'Green Leaf Index — genormaliseerde groen-index voor RGB.', purpose: 'Bladgroen RGB', range: '-1 tot 1', type: 'rgb', clampRange: true, needsGreen: true, needsRed: true, needsBlue: true },
  { id: 'vNDVI', label: 'vNDVI', formula: '0.5268 × R⁻⁰·¹²⁹⁴ × G⁰·³³⁸⁹ × B⁻⁰·³¹¹⁸', desc: 'Visible NDVI — empirische NDVI-schatter voor RGB-sensoren.', purpose: 'RGB NDVI-schatter', range: '0 tot 1', type: 'rgb', clampRange: false, needsRed: true, needsGreen: true, needsBlue: true },
  { id: 'NDYI', label: 'NDYI', formula: '(G − B) / (G + B)', desc: 'Normalized Difference Yellowness Index — detecteert vergeling/ziekte.', purpose: 'Ziektedetectie, vergeling', range: '-1 tot 1', type: 'rgb', clampRange: true, needsGreen: true, needsBlue: true },
];

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
  numAlphaBands: 0,
  bandRed: null,
  bandGreen: null,
  bandBlue: null,
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
