/* ===========================================
   i18n — Translations (NL & EN)
   Taakkaart Generator
   =========================================== */
(function (global) {
  'use strict';

  var TRANSLATIONS = {
    nl: {
      // ── General UI ───────────────────────────
      title:          'Taakkaart Generator',
      subtitle:       'NDVI \u2192 Variabele Dosering',
      githubTitle:    'Bekijk op GitHub',

      // ── Steps ────────────────────────────────
      step1:          'GeoTIFF Laden',
      step1Desc:      'Upload een WebODM multispectrale GeoTIFF (odm_orthophoto.tif)',
      step2:          'Banden \u0026 Index',
      step2Desc:      'Selecteer de banden en vegetatie-index.',
      step3:          'Percelen Selecteren',
      step3Desc:      'Klik op een perceel om het te selecteren of te deselecteren. Meerdere percelen zijn mogelijk.',
      step4:          'Taakkaart Instellen',
      step5:          'Exporteren',

      // ── Step 1 ───────────────────────────────
      fileDropText:   'Klik of sleep een GeoTIFF',
      labelFile:      'Bestand:',
      labelDims:      'Afmetingen:',
      labelBands:     'Banden:',
      labelMode:      'Modus:',
      labelNdviRange: 'NDVI bereik:',

      // ── Step 2 ───────────────────────────────
      labelVI:        'Vegetatie-index',
      labelStretch:   'Kleurschaal aanpassen aan data',
      labelResolution:'Resolutie:',
      res512:         '512 (snel)',
      res8192:        '8192 (nauwkeurig)',
      btnComputeNDVI: 'Bereken index',

      // ── Step 3 ───────────────────────────────
      labelSelected:  'Geselecteerd:',
      labelArea:      'Totale oppervlakte:',
      btnClearParcels:'Deselecteer alles',
      parcelHint:     'Zoom verder in om BRP percelen te laden (zoom \u2265 14).',

      // ── Step 4 ───────────────────────────────
      labelGridSize:  'Gridgrootte',
      labelUnit:      'Eenheid',
      unitEenheden:   'eenheden/ha',
      labelDirection: 'Rijrichting',
      btnNorthSouth:  '\u2195 Noord-Zuid (klassiek)',
      btnAutoAngle:   'Optimale rijrichting',
      labelNdviDist:  'NDVI verdeling',
      labelClasses:   'Klassen',
      btnAutoClassify:'auto-classificeer',
      btnAddClass:    '+ Klasse toevoegen',
      btnGenerate:    'Genereer Taakkaart',

      // ── Step 5 ───────────────────────────────
      labelExportName:'Bestandsnaam',

      // ── Misc UI ──────────────────────────────
      loading:        'Laden...',
      legendLow:      'laag',
      legendHigh:     'hoog',
      mobileHide:     'Verberg',
      mobilePanel:    'Paneel',

      // ── Layer control ────────────────────────
      lcBackground:   'Achtergrond',
      lcLayers:       'Lagen',
      lcTaskmap:      '\uD83D\uDCCB Taakkaart',
      lcParcels:      '\uD83D\uDFE1 Percelen',
      lcSelection:    '\u2705 Selectie',

      // ── Class table headers ──────────────────
      clsName:        'Naam',
      clsFrom:        'Van',
      clsTo:          'Tot',
      clsDose:        'Dosering',

      // ── Default class names ──────────────────
      clsVeryLow:     'Zeer laag',
      clsLow:         'Laag',
      clsMid:         'Midden',
      clsHigh:        'Hoog',
      clsVeryHigh:    'Zeer hoog',

      // ── Export stats ─────────────────────────
      statCells:      'Totaal cellen',
      statArea:       'Totaal oppervlakte',
      statProduct:    'Totaal product',

      // ── Dynamic strings (app.js) ─────────────
      loadingGeoTIFF:       'GeoTIFF metadata lezen\u2026',
      loadingBands:         'Banden laden ({0}\xd7{1} px)\u2026',
      loadingReload:        'GeoTIFF herladen op {0} px\u2026',
      loadingVI:            '{0} berekenen...',
      loadingGenerate:      'Taakkaart genereren...',
      loadingISOXML:        'ISOXML bouwen...',

      toastResolutionSet:   'Resolutie ingesteld op {0} px.',
      toastResolutionFail:  'Resolutie wijzigen mislukt: {0}',
      toastNDVIDetected:    'Pre-berekende NDVI gedetecteerd.',
      toastRGBDetected:     'RGB Plant Health kaart gedetecteerd \u2014 wordt direct weergegeven.',
      toastGeoTIFFLoaded:   'GeoTIFF geladen. Controleer de banden.',
      toastLoadError:       'Fout bij laden: {0}',
      toastSameBands:       'De twee gebruikte banden mogen niet dezelfde zijn.',
      toastVIComputed:      '{0} berekend en weergegeven.',
      toastNoValidPixels:   'Geen geldige NDVI pixels \u2014 controleer de geselecteerde banden',
      toastNoNDVI:          'Laad eerst een NDVI kaart.',
      toastClassesSet:      'Klassen ingesteld op gelijke NDVI-oppervlakte ({0} klassen).',
      toastParcelRemoved:   'Perceel verwijderd.',
      toastParcelAdded:     'Perceel toegevoegd! ({0} geselecteerd)',
      toastOutsideRaster:   'Perceel ligt buiten het rastergebied \u2014 kan niet knippen.',
      toastNoValidNDVI:     'Geen geldige NDVI pixels in geselecteerd perceel.',
      toastSelectionCleared:'Selectie gewist.',
      toastNorthSouth:      'Rijrichting: Noord-Zuid (0\xb0)',
      toastSelectParcel:    'Selecteer eerst een perceel.',
      toastAngleSet:        'Rijrichting ingesteld op {0}\xb0',
      toastSelectParcels:   'Selecteer eerst een of meer percelen.',
      toastGenerated:       'Taakkaart gegenereerd!',
      toastGenerateError:   'Fout bij genereren: {0}',
      toastGenerateFirst:   'Genereer eerst een taakkaart.',
      toastShpDownload:     'Shapefile download gestart.',
      toastExportError:     'Export fout: {0}',
      toastGeoJSONDownload: 'GeoJSON download gestart.',
      toastCSVDownload:     'CSV download gestart.',
      toastISOXMLDownload:  'ISOXML download gestart.',
      toastISOXMLError:     'ISOXML fout: {0}',
      toastGridTooLarge:    'Grid te groot voor ISOXML \u2014 vergroot de gridgrootte.',

      modePrecalcNDVI:      'Pre-berekende NDVI (1 band)',
      modeRGBMap:           'RGB kleurenkaart (Plant Health export)',
      bandDescRGB:          'RGB kleurenkaart gedetecteerd. Klik hieronder op \u201cBereken index\u201d om handmatig Red en NIR banden te kiezen als de detectie niet klopt.',
      modeBands:            '{0} banden',
      loadedAs:             ' (geladen als {0}\xd7{1} px)',
      bandDescMulti:        'Selecteer de Red en NIR banden voor NDVI-berekening.',

      parcelHintZoom:       'Zoom verder in om BRP percelen te laden (zoom \u2265 {0}).',
      parcelHintLoading:    'BRP percelen laden...',
      parcelHintLoaded:     '{0} percelen geladen. Klik om te selecteren.',
      parcelHintFailed:     'BRP laden mislukt. Probeer opnieuw.',

      parcelCount1:         '{0} perceel',
      parcelCountN:         '{0} percelen',
      parcelN:              'Perceel {0}',

      cropHistLoading:      'gewasgeschiedenis laden\u2026',
      cropHistNone:         'geen data beschikbaar',
      cropHistError:        'fout',
      cropHistNA:           'niet beschikbaar',

      autoAngleHintNS:      'Noord-Zuid (klassiek fishnet)',
      autoAngleHintAngle:   'Rijrichting: {0}\xb0 (langste zijde perceel)',
    },

    en: {
      // ── General UI ───────────────────────────
      title:          'Task Map Generator',
      subtitle:       'NDVI \u2192 Variable Rate Application',
      githubTitle:    'View on GitHub',

      // ── Steps ────────────────────────────────
      step1:          'Load GeoTIFF',
      step1Desc:      'Upload a WebODM multispectral GeoTIFF (odm_orthophoto.tif)',
      step2:          'Bands \u0026 Index',
      step2Desc:      'Select the bands and vegetation index.',
      step3:          'Select Fields',
      step3Desc:      'Click a field to select or deselect it. Multiple fields can be selected.',
      step4:          'Configure Task Map',
      step5:          'Export',

      // ── Step 1 ───────────────────────────────
      fileDropText:   'Click or drop a GeoTIFF',
      labelFile:      'File:',
      labelDims:      'Dimensions:',
      labelBands:     'Bands:',
      labelMode:      'Mode:',
      labelNdviRange: 'NDVI range:',

      // ── Step 2 ───────────────────────────────
      labelVI:        'Vegetation index',
      labelStretch:   'Fit colour scale to data',
      labelResolution:'Resolution:',
      res512:         '512 (fast)',
      res8192:        '8192 (precise)',
      btnComputeNDVI: 'Compute index',

      // ── Step 3 ───────────────────────────────
      labelSelected:  'Selected:',
      labelArea:      'Total area:',
      btnClearParcels:'Deselect all',
      parcelHint:     'Zoom in further to load BRP fields (zoom \u2265 14).',

      // ── Step 4 ───────────────────────────────
      labelGridSize:  'Grid size',
      labelUnit:      'Unit',
      unitEenheden:   'units/ha',
      labelDirection: 'Row direction',
      btnNorthSouth:  '\u2195 North\u2013South (classic)',
      btnAutoAngle:   'Optimal row direction',
      labelNdviDist:  'NDVI distribution',
      labelClasses:   'Classes',
      btnAutoClassify:'auto-classify',
      btnAddClass:    '+ Add class',
      btnGenerate:    'Generate Task Map',

      // ── Step 5 ───────────────────────────────
      labelExportName:'File name',

      // ── Misc UI ──────────────────────────────
      loading:        'Loading...',
      legendLow:      'low',
      legendHigh:     'high',
      mobileHide:     'Hide',
      mobilePanel:    'Panel',

      // ── Layer control ────────────────────────
      lcBackground:   'Background',
      lcLayers:       'Layers',
      lcTaskmap:      '\uD83D\uDCCB Task map',
      lcParcels:      '\uD83D\uDFE1 Fields',
      lcSelection:    '\u2705 Selection',

      // ── Class table headers ──────────────────
      clsName:        'Name',
      clsFrom:        'From',
      clsTo:          'To',
      clsDose:        'Rate',

      // ── Default class names ──────────────────
      clsVeryLow:     'Very low',
      clsLow:         'Low',
      clsMid:         'Medium',
      clsHigh:        'High',
      clsVeryHigh:    'Very high',

      // ── Export stats ─────────────────────────
      statCells:      'Total cells',
      statArea:       'Total area',
      statProduct:    'Total product',

      // ── Dynamic strings (app.js) ─────────────
      loadingGeoTIFF:       'Reading GeoTIFF metadata\u2026',
      loadingBands:         'Loading bands ({0}\xd7{1} px)\u2026',
      loadingReload:        'Reloading GeoTIFF at {0} px\u2026',
      loadingVI:            'Computing {0}...',
      loadingGenerate:      'Generating task map...',
      loadingISOXML:        'Building ISOXML...',

      toastResolutionSet:   'Resolution set to {0} px.',
      toastResolutionFail:  'Failed to change resolution: {0}',
      toastNDVIDetected:    'Pre-computed NDVI detected.',
      toastRGBDetected:     'RGB Plant Health map detected \u2014 displaying directly.',
      toastGeoTIFFLoaded:   'GeoTIFF loaded. Please check the bands.',
      toastLoadError:       'Error loading file: {0}',
      toastSameBands:       'The two selected bands must not be the same.',
      toastVIComputed:      '{0} computed and displayed.',
      toastNoValidPixels:   'No valid NDVI pixels \u2014 please check the selected bands',
      toastNoNDVI:          'Please load an NDVI map first.',
      toastClassesSet:      'Classes set to equal NDVI area ({0} classes).',
      toastParcelRemoved:   'Field removed.',
      toastParcelAdded:     'Field added! ({0} selected)',
      toastOutsideRaster:   'Field is outside the raster area \u2014 cannot clip.',
      toastNoValidNDVI:     'No valid NDVI pixels in selected field.',
      toastSelectionCleared:'Selection cleared.',
      toastNorthSouth:      'Row direction: North\u2013South (0\xb0)',
      toastSelectParcel:    'Please select a field first.',
      toastAngleSet:        'Row direction set to {0}\xb0',
      toastSelectParcels:   'Please select one or more fields first.',
      toastGenerated:       'Task map generated!',
      toastGenerateError:   'Error generating task map: {0}',
      toastGenerateFirst:   'Please generate a task map first.',
      toastShpDownload:     'Shapefile download started.',
      toastExportError:     'Export error: {0}',
      toastGeoJSONDownload: 'GeoJSON download started.',
      toastCSVDownload:     'CSV download started.',
      toastISOXMLDownload:  'ISOXML download started.',
      toastISOXMLError:     'ISOXML error: {0}',
      toastGridTooLarge:    'Grid too large for ISOXML \u2014 increase the grid size.',

      modePrecalcNDVI:      'Pre-computed NDVI (1 band)',
      modeRGBMap:           'RGB colour map (Plant Health export)',
      bandDescRGB:          'RGB colour map detected. Click \u201cCompute index\u201d below to manually select Red and NIR bands if the detection is incorrect.',
      modeBands:            '{0} bands',
      loadedAs:             ' (loaded as {0}\xd7{1} px)',
      bandDescMulti:        'Select the Red and NIR bands for NDVI computation.',

      parcelHintZoom:       'Zoom in further to load BRP fields (zoom \u2265 {0}).',
      parcelHintLoading:    'Loading BRP fields...',
      parcelHintLoaded:     '{0} fields loaded. Click to select.',
      parcelHintFailed:     'BRP loading failed. Please try again.',

      parcelCount1:         '{0} field',
      parcelCountN:         '{0} fields',
      parcelN:              'Field {0}',

      cropHistLoading:      'loading crop history\u2026',
      cropHistNone:         'no data available',
      cropHistError:        'error',
      cropHistNA:           'not available',

      autoAngleHintNS:      'North\u2013South (classic fishnet)',
      autoAngleHintAngle:   'Row direction: {0}\xb0 (longest field boundary)',
    }
  };

  // ── Language state ───────────────────────────────────────────────────────
  // Priority: 1) user's saved choice  2) browser language  3) fallback 'nl'
  function detectBrowserLang() {
    var langs = navigator.languages && navigator.languages.length
      ? Array.from(navigator.languages)
      : [navigator.language || navigator.userLanguage || 'nl'];
    for (var i = 0; i < langs.length; i++) {
      var code = langs[i].toLowerCase().split('-')[0]; // 'en-US' → 'en'
      if (TRANSLATIONS[code]) return code;
    }
    return 'nl';
  }

  var currentLang = localStorage.getItem('lang') || detectBrowserLang();

  // ── Translation helpers ──────────────────────────────────────────────────

  /** Returns translated string for key in the current language. */
  function t(key) {
    var tr = TRANSLATIONS[currentLang] || TRANSLATIONS.nl;
    return tr[key] !== undefined ? tr[key]
         : TRANSLATIONS.nl[key] !== undefined ? TRANSLATIONS.nl[key]
         : key;
  }

  /**
   * Like t(), but replaces {0}, {1}, … placeholders with extra arguments.
   * Example: tf('parcelHintZoom', 14) → 'Zoom in further to load BRP fields (zoom ≥ 14).'
   */
  function tf(key) {
    var s = t(key);
    for (var i = 1; i < arguments.length; i++) {
      s = s.replace('{' + (i - 1) + '}', arguments[i]);
    }
    return s;
  }

  /** Apply translations to every [data-i18n] element and update the page title. */
  function applyLang() {
    document.documentElement.lang = currentLang;
    document.title = t('title');

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var attr = el.getAttribute('data-i18n-attr');
      if (attr) {
        el.setAttribute(attr, t(key));
      } else {
        el.textContent = t(key);
      }
    });

    // Keep lang toggle label pointing to the OTHER language
    var btn = document.getElementById('lang-toggle');
    if (btn) btn.textContent = currentLang === 'nl' ? 'EN' : 'NL';

    // Notify app.js so it can re-render dynamic sections
    window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: currentLang } }));
  }

  /** Switch to the given language and persist the choice. */
  function setLang(lang) {
    if (!TRANSLATIONS[lang]) return;
    currentLang = lang;
    localStorage.setItem('lang', lang);
    applyLang();
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────
  // Wire up the toggle button (DOM is ready because this script is at bottom of body)
  var langBtn = document.getElementById('lang-toggle');
  if (langBtn) {
    langBtn.addEventListener('click', function () {
      setLang(currentLang === 'nl' ? 'en' : 'nl');
    });
  }

  // Apply initial language
  applyLang();

  // ── Exports ──────────────────────────────────────────────────────────────
  global.t = t;
  global.tf = tf;
  global.applyLang = applyLang;
  global.setLang = setLang;

}(window));
