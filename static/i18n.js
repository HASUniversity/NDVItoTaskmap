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
      step1label:     'Laden',
      step2label:     'Percelen',
      step3label:     'Index',
      step4label:     'Analyse',
      step5label:     'Kaart',
      step6label:     'Export',
      step1:          'GeoTIFF Laden',
      step1Desc:      'Upload een WebODM multispectrale GeoTIFF (odm_orthophoto.tif)',
      step2:          'Percelen Selecteren',
      step2Desc:      'Klik op een perceel om het te selecteren of te deselecteren. Meerdere percelen zijn mogelijk.',
      step3:          'Banden \u0026 Index',
      step3Desc:      'Selecteer de banden en vegetatie-index.',
      step4:          'Data Analyse',
      step4:          'Data Analyse',
      step5:          'Taakkaart Instellen',
      step6:          'Exporteren',

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
      btnComputeNDVI: 'Bereken index',
      wdviSoilLineTitle:  'WDVI Soil Line (a)',
      wdviSoilLineDesc:   'De soil-line parameter a corrigeert voor bodemreflectie. Hogere a = meer bodemcorrectie.',
      wdviPresetSand:     'Zand (1.0)',
      wdviPresetClay:     'Klei (1.25)',
      wdviPresetOrganic:  'Organisch (0.95)',
      wdviPresetCustom:   'Aangepast',
      wdviFormula:        'Formule: NIR − {0} × R',

      // ── Step 3 ───────────────────────────────
      labelSelected:  'Geselecteerd:',
      labelArea:      'Totale oppervlakte:',
      btnClearParcels:'Deselecteer alles',
      quickExportTitle:'Tussentijdse export',
      quickExportDesc:'Download alleen de NDVI uitsnede van de geselecteerde percelen \u2014 bruikbaar voor scouting, analyse of een ander GIS-pakket.',
      quickExportParcelDesc:'Download de geometrie van de geselecteerde percelen \u2014 bruikbaar voor scouting, analyse of een ander GIS-pakket.',
      btnContinueToTaskmap:'Verder: Taakkaart instellen \u2192',
      btnContinueToAnalysis:'Verder: Data analyse \u2192',
      parcelHint:     'Zoom verder in om BRP percelen te laden (zoom \u2265 14).',

      // ── Step 4 ───────────────────────────────
      labelGridSize:  'Gridgrootte',
      labelUnit:      'Eenheid',
      unitZaden:      'zaden/ha',
      unitStuks:      'stuks/ha',
      unitDoses:      'doses/ha',
      unitEenheden:   'eenheden/ha',
      labelDirection: 'Rijrichting',
      btnNorthSouth:  '\u2195 Noord-Zuid (klassiek)',
      btnAutoAngle:   'Optimale rijrichting',
      labelClassMethod:'Classificatie methode',
      cmQuantile:     'Quantile (gelijke oppervlakte)',
      cmEqualInterval:'Gelijk interval',
      cmStdDev:       'Standaarddeviatie',
      cmGeometric:    'Geometrisch interval',
      cmPretty:       'Pretty breaks (mooie getallen)',
      cmJenks:        'Natural breaks (Jenks)',
      cmManual:       'Handmatig',
      labelNdviDist:  'Index verdeling',
      labelClasses:   'Klassen',
      btnAutoClassify:'auto-classificeer',
      btnAddClass:    '+ Klasse toevoegen',
      btnGenerate:    'Genereer Taakkaart',

      // ── Step 5 ───────────────────────────────
      labelExportName:'Bestandsnaam',
      labelDosagePerClass:'Dosering per klasse',

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
      lcBodemLegend:  'Bodemtypen in beeld',

      // ── Class table headers ──────────────────
      clsName:        'Naam',
      clsFrom:        'Van',
      clsTo:          'Tot',
      clsDose:        'Dosering',

      // ── Default class names ──────────────────
      clsVeryLow:     'Zeer laag',
      clsLow:         'Laag',
      clsLowMid:      'Laag-midden',
      clsMid:         'Midden',
      clsHighMid:     'Hoog-midden',
      clsHigh:        'Hoog',
      clsVeryHigh:    'Zeer hoog',
      clsNewClass:    'Klasse {0}',

      // ── Export stats ─────────────────────────
      statCells:      'Totaal cellen',
      statArea:       'Totaal oppervlakte',
      statProduct:    'Totaal product',

      // ── Wizard navigation ─────────────────────
      btnBack:        'Vorige',
      btnNext:        'Volgende',
      btnSkip:        'Overslaan',
      stepXofY:       'Stap {0} van {1}',
      stepOf:         'van',
      advancedShow:   'Geavanceerde opties',
      advancedHide:   'Basis opties',

      // ── Dynamic strings (app.js) ─────────────
      loadingGeoTIFF:       'GeoTIFF metadata lezen\u2026',
      loadingBands:         'Banden laden ({0}\xd7{1} px)\u2026',
      loadingReload:        'GeoTIFF herladen op {0} px\u2026',
      loadingVI:            '{0} berekenen...',
      loadingRender:         'Kaartlaag renderen...',
      loadingGenerate:      'Taakkaart genereren...',
      loadingISOXML:        'ISOXML bouwen...',

      toastResolutionSet:   'Resolutie ingesteld op {0} px.',
      toastResolutionFail:  'Resolutie wijzigen mislukt: {0}',
      toastNDVIDetected:    'Pre-berekende NDVI gedetecteerd.',
      toastRGBDetected:     'RGB Plant Health kaart gedetecteerd \u2014 wordt direct weergegeven.',
      toastGeoTIFFLoaded:   'GeoTIFF geladen. Controleer de banden.',
      toastLoadError:       'Fout bij laden: {0}',
      toastSameBands:       'De twee gebruikte banden mogen niet dezelfde zijn.',
      toastMissingBand:     'De geselecteerde index ({0}) heeft een band nodig die niet beschikbaar is — kies een andere index of laad een geschikte TIF.',
      toastVIComputed:      '{0} berekend en weergegeven.',
      toastNoValidPixels:   'Geen geldige NDVI pixels \u2014 controleer de geselecteerde banden',
      toastNoNDVI:          'Laad eerst een NDVI kaart.',
      toastClassesSet:      'Klassen ingesteld op gelijke NDVI-oppervlakte ({0} klassen).',
      toastClassifyManual:  'Handmatige modus — pas klassen zelf aan.',
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
      toastNdviTiffDownload:'NDVI GeoTIFF download gestart.',
      toastPDFExport:       'PDF download gestart.',
      toastPdfExportError:  'PDF export fout: {0}',
      loadingPDF:           'PDF genereren...',
      pdfTitle:             'Taakkaart',
      pdfSubtitle:          'NDVI - Variabele Dosering',
      pdfGenerated:         'Gegenereerd op',
      pdfSource:            'Bronbestand',
      pdfGrid:              'Gridgrootte',
      pdfUnit:              'Eenheid',
      pdfArea:              'Totale oppervlakte',
      pdfLegend:            'Legenda - Dosering per klasse',
      pdfRate:              'Dosering',
      pdfNDVIRange:         'NDVI-bereik',
      pdfCoordinateSystem:  'Coördinatensysteem',
      pdfCellCount:         'Aantal cellen',
      toastParcelShpDownload:'Percelen Shapefile download gestart.',
      toastParcelGpkgDownload:'Percelen GeoPackage download gestart.',
      toastNdviTiffEmpty:   'Geen NDVI pixels binnen de selectie \u2014 niets te exporteren.',
      toastNdviTiffNeedParcels:'Selecteer eerst \u00e9\u00e9n of meer percelen.',
      toastISOXMLError:     'ISOXML fout: {0}',
      toastGridTooLarge:    'Grid te groot voor ISOXML \u2014 vergroot de gridgrootte.',

      modePrecalcNDVI:      'Pre-berekende NDVI (1 band)',
      modeRGBMap:           'RGB kleurenkaart (Plant Health export)',
      bandDescRGB:          'RGB kleurenkaart gedetecteerd. Klik hieronder op \u201cBereken index\u201d om handmatig Red en NIR banden te kiezen als de detectie niet klopt.',
      modeBands:            '{0} banden',
      loadedAs:             ' (geladen als {0}\xd7{1} px)',
      bandDescMulti:        'Selecteer de juiste banden voor de gekozen vegetatie-index. Alleen relevante banden worden getoond.',

      parcelHintZoom:       'Zoom verder in om BRP percelen te laden (zoom \u2265 {0}).',
      parcelHintLoading:    'BRP percelen laden...',
      parcelHintLoaded:     '{0} percelen geladen. Klik om te selecteren.',
      parcelHintFailed:     'BRP laden mislukt. Probeer opnieuw.',
      parcelHintTimeout:    'BRP-server reageert niet (timeout). Percelen handmatig tekenen of later opnieuw proberen.',

      parcelCount1:         '{0} perceel',
      parcelCountN:         '{0} percelen',
      parcelN:              'Perceel {0}',

      cropHistLoading:      'gewasgeschiedenis laden\u2026',
      cropHistNone:         'geen data beschikbaar',
      cropHistError:        'fout',
      cropHistNA:           'niet beschikbaar',

      autoAngleHintNS:      'Noord-Zuid (klassiek fishnet)',
      autoAngleHintAngle:   'Rijrichting: {0}\xb0 (langste zijde perceel)',

      // ── Drawing tools (Step 2) ──────────────
      drawSectionTitle:     'Veld intekenen / Uploaden',
      drawSectionDesc:      'Teken een veld op de kaart of upload een GeoJSON bestand. Werkt wereldwijd.',
      drawPolygon:          'Teken veld',
      drawRect:             'Teken rechthoek',
      uploadGeoJSON:        'Upload GeoJSON',
      drawClickFirst:       'Klik op de kaart om het eerste punt te plaatsen',
      drawClickNext:        'Klik om volgende punt te plaatsen — dubbelklik of klik op eerste punt om te sluiten',
      drawCancel:           'Annuleren',
      drawFinish:           'Voltooi polygoon',
      toastDrawStarted:     'Tekenmodus actief — klik op de kaart om punten te plaatsen',
      toastDrawCancelled:   'Tekenen geannuleerd',
      toastDrawComplete:    'Veld toegevoegd! ({0} punten)',
      toastGeoJSONLoaded:   'GeoJSON geladen — {0} veld(en) toegevoegd',
      toastGeoJSONError:    'Fout bij laden GeoJSON: {0}',

      // ── Cell override (Step 5) ──────────────
      cellOverrideTitle:    'Cel Overschrijven',
      cellClass:            'Klasse:',
      cellNDVI:             'NDVI:',
      cellArea:             'Oppervlakte:',
      cellDoseLabel:        'Aangepaste dosering',
      cellApply:            'Toepassen',
      cellClear:            'Herstel klasse',
      toastCellOverride:    'Cel dosering overschreven naar {0} {1}',
      toastCellCleared:     'Cel dosering hersteld naar klasse-waarde',
      toastCellSelect:      'Klik op een grid-cel om de dosering aan te passen',
      toastNoCell:         'Geen cel geselecteerd',
    },

    en: {
      // ── General UI ───────────────────────────
      title:          'Task Map Generator',
      subtitle:       'NDVI \u2192 Variable Rate Application',
      githubTitle:    'View on GitHub',

      // ── Steps ────────────────────────────────
      step1label:     'Load',
      step2label:     'Fields',
      step3label:     'Index',
      step4label:     'Analysis',
      step5label:     'Map',
      step6label:     'Export',
      step1:          'Load GeoTIFF',
      step1Desc:      'Upload a WebODM multispectral GeoTIFF (odm_orthophoto.tif)',
      step2:          'Select Fields',
      step2Desc:      'Click a field to select or deselect it. Multiple fields can be selected.',
      step3:          'Bands \u0026 Index',
      step3Desc:      'Select the bands and vegetation index.',
      step4:          'Data Analysis',
      step4:          'Data Analysis',
      step5:          'Configure Task Map',
      step6:          'Export',

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
      btnComputeNDVI: 'Compute index',
      wdviSoilLineTitle:  'WDVI Soil Line (a)',
      wdviSoilLineDesc:   'The soil-line parameter a corrects for soil reflectance. Higher a = stronger soil correction.',
      wdviPresetSand:     'Sand (1.0)',
      wdviPresetClay:     'Clay (1.25)',
      wdviPresetOrganic:  'Organic (0.95)',
      wdviPresetCustom:   'Custom',
      wdviFormula:        'Formula: NIR − {0} × R',

      // ── Step 3 ───────────────────────────────
      labelSelected:  'Selected:',
      labelArea:      'Total area:',
      btnClearParcels:'Deselect all',
      quickExportTitle:'Quick export',
      quickExportDesc:'Download only the NDVI clip of the selected fields \u2014 useful for scouting, analysis or another GIS package.',
      quickExportParcelDesc:'Download the geometry of the selected fields \u2014 useful for scouting, analysis or another GIS package.',
      btnContinueToTaskmap:'Continue: Configure task map \u2192',
      btnContinueToAnalysis:'Continue: Data analysis \u2192',
      parcelHint:     'Zoom in further to load BRP fields (zoom \u2265 14).',

      // ── Step 4 ───────────────────────────────
      labelGridSize:  'Grid size',
      labelUnit:      'Unit',
      unitZaden:      'seeds/ha',
      unitStuks:      'pieces/ha',
      unitDoses:      'doses/ha',
      unitEenheden:   'units/ha',
      labelDirection: 'Row direction',
      btnNorthSouth:  '\u2195 North\u2013South (classic)',
      btnAutoAngle:   'Optimal row direction',
      labelClassMethod:'Classification method',
      cmQuantile:     'Quantile (equal area)',
      cmEqualInterval:'Equal interval',
      cmStdDev:       'Standard deviation',
      cmGeometric:    'Geometric interval',
      cmPretty:       'Pretty breaks (nice numbers)',
      cmJenks:        'Natural breaks (Jenks)',
      cmManual:       'Manual',
      labelNdviDist:  'Index distribution',
      labelClasses:   'Classes',
      btnAutoClassify:'auto-classify',
      btnAddClass:    '+ Add class',
      btnGenerate:    'Generate Task Map',

      // ── Step 5 ───────────────────────────────
      labelExportName:'File name',
      labelDosagePerClass:'Rate per class',

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
      lcBodemLegend:  'Soil types in view',

      // ── Class table headers ──────────────────
      clsName:        'Name',
      clsFrom:        'From',
      clsTo:          'To',
      clsDose:        'Rate',

      // ── Default class names ──────────────────
      clsVeryLow:     'Very low',
      clsLow:         'Low',
      clsLowMid:      'Low-medium',
      clsMid:         'Medium',
      clsHighMid:     'High-medium',
      clsHigh:        'High',
      clsVeryHigh:    'Very high',
      clsNewClass:    'Class {0}',

      // ── Export stats ─────────────────────────
      statCells:      'Total cells',
      statArea:       'Total area',
      statProduct:    'Total product',
      // ── Wizard navigation ─────────────────────
      btnBack:        'Back',
      btnNext:        'Next',
      btnSkip:        'Skip',
      stepXofY:       'Step {0} of {1}',
      stepOf:         'of',
      advancedShow:   'Advanced options',
      advancedHide:   'Basic options',
      // ── Dynamic strings (app.js) ─────────────
      loadingGeoTIFF:       'Reading GeoTIFF metadata\u2026',
      loadingBands:         'Loading bands ({0}\xd7{1} px)\u2026',
      loadingReload:        'Reloading GeoTIFF at {0} px\u2026',
      loadingVI:            'Computing {0}...',
      loadingRender:         'Rendering map layer...',
      loadingGenerate:      'Generating task map...',
      loadingISOXML:        'Building ISOXML...',

      toastResolutionSet:   'Resolution set to {0} px.',
      toastResolutionFail:  'Failed to change resolution: {0}',
      toastNDVIDetected:    'Pre-computed NDVI detected.',
      toastRGBDetected:     'RGB Plant Health map detected \u2014 displaying directly.',
      toastGeoTIFFLoaded:   'GeoTIFF loaded. Please check the bands.',
      toastLoadError:       'Error loading file: {0}',
      toastSameBands:       'The two selected bands must not be the same.',
      toastMissingBand:     'The selected index ({0}) needs a band that is not available \u2014 choose a different index or load a suitable TIF.',
      toastVIComputed:      '{0} computed and displayed.',
      toastNoValidPixels:   'No valid NDVI pixels \u2014 please check the selected bands',
      toastNoNDVI:          'Please load an NDVI map first.',
      toastClassesSet:      'Classes set to equal NDVI area ({0} classes).',
      toastClassifyManual:  'Manual mode — adjust classes yourself.',
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
      toastNdviTiffDownload:'NDVI GeoTIFF download started.',
      toastPDFExport:       'PDF download started.',
      toastPdfExportError:  'PDF export error: {0}',
      loadingPDF:           'Generating PDF...',
      pdfTitle:             'Task Map',
      pdfSubtitle:          'NDVI - Variable Rate Application',
      pdfGenerated:         'Generated on',
      pdfSource:            'Source file',
      pdfGrid:              'Grid size',
      pdfUnit:              'Unit',
      pdfArea:              'Total area',
      pdfLegend:            'Legend - Rate per class',
      pdfRate:              'Rate',
      pdfNDVIRange:         'NDVI range',
      pdfCoordinateSystem:  'Coordinate system',
      pdfCellCount:         'Number of cells',
      toastParcelShpDownload:'Parcels Shapefile download started.',
      toastParcelGpkgDownload:'Parcels GeoPackage download started.',
      toastNdviTiffEmpty:   'No NDVI pixels inside selection \u2014 nothing to export.',
      toastNdviTiffNeedParcels:'Please select one or more fields first.',
      toastISOXMLError:     'ISOXML error: {0}',
      toastGridTooLarge:    'Grid too large for ISOXML \u2014 increase the grid size.',

      modePrecalcNDVI:      'Pre-computed NDVI (1 band)',
      modeRGBMap:           'RGB colour map (Plant Health export)',
      bandDescRGB:          'RGB colour map detected. Click \u201cCompute index\u201d below to manually select Red and NIR bands if the detection is incorrect.',
      modeBands:            '{0} bands',
      loadedAs:             ' (loaded as {0}\xd7{1} px)',
      bandDescMulti:        'Select the correct bands for the chosen vegetation index. Only relevant bands are shown.',

      parcelHintZoom:       'Zoom in further to load BRP fields (zoom \u2265 {0}).',
      parcelHintLoading:    'Loading BRP fields...',
      parcelHintLoaded:     '{0} fields loaded. Click to select.',
      parcelHintFailed:     'BRP loading failed. Please try again.',
      parcelHintTimeout:    'BRP server not responding (timeout). Draw fields manually or try again later.',

      parcelCount1:         '{0} field',
      parcelCountN:         '{0} fields',
      parcelN:              'Field {0}',

      cropHistLoading:      'loading crop history\u2026',
      cropHistNone:         'no data available',
      cropHistError:        'error',
      cropHistNA:           'not available',

      autoAngleHintNS:      'North\u2013South (classic fishnet)',
      autoAngleHintAngle:   'Row direction: {0}\xb0 (longest field boundary)',

      // ── Drawing tools (Step 2) ──────────────
      drawSectionTitle:     'Draw / Upload Field',
      drawSectionDesc:      'Draw a field on the map or upload a GeoJSON file. Works worldwide.',
      drawPolygon:          'Draw field',
      drawRect:             'Draw rectangle',
      uploadGeoJSON:        'Upload GeoJSON',
      drawClickFirst:       'Click on the map to place the first vertex',
      drawClickNext:        'Click to place next vertex — double-click or click first point to close',
      drawCancel:           'Cancel',
      drawFinish:           'Finish polygon',
      toastDrawStarted:     'Drawing mode active — click the map to place vertices',
      toastDrawCancelled:   'Drawing cancelled',
      toastDrawComplete:    'Field added! ({0} vertices)',
      toastGeoJSONLoaded:   'GeoJSON loaded — {0} field(s) added',
      toastGeoJSONError:    'Error loading GeoJSON: {0}',

      // ── Cell override (Step 5) ──────────────
      cellOverrideTitle:    'Override Cell',
      cellClass:            'Class:',
      cellNDVI:             'NDVI:',
      cellArea:             'Area:',
      cellDoseLabel:        'Custom rate',
      cellApply:            'Apply',
      cellClear:            'Restore class',
      toastCellOverride:    'Cell rate overridden to {0} {1}',
      toastCellCleared:     'Cell rate restored to class value',
      toastCellSelect:      'Click a grid cell to adjust its rate',
      toastNoCell:         'No cell selected',
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
