# Changelog

## [Unreleased]

### Mirror & instructies
- Project gespiegeld naar `D:\GIT\NDVItoTaskmap` met Robocopy-script.
- `copilot-instructions.md` toegevoegd met verplichte stappen bij elke wijziging:
  README bijwerken, CHANGELOG bijwerken, sync naar mirror.
- `CHANGELOG.md` aangemaakt in de bron (was alleen in mirror aanwezig).

### Wizard-navigatie & UX
- Stappen worden nu getoond met een **progress indicator** (6 stappen: Laden → Index → Percelen → Analyse → Kaart → Export).
- **Volgende/Vorige** knoppen onderaan elke stap voor lineaire doorloop.
- **Toetsenbord navigatie** — Pijltjes links/rechts of PageUp/PageDown om te navigeren.
- **Geavanceerde opties** — Bandselectie en taakkaartopties zijn samenvouwbaar („Geavanceerde opties“) voor een opgeruimde UI.
- **Auto-scroll** op mobiel naar de actieve stap.

### Classificatie-methoden (Stap 4 — Data Analyse)
- Nieuwe stap *Data Analyse* tussen Percelen en Taakkaart instellen.
- **7 classificatie-methoden**: Quantile (default), Gelijk interval, Standaarddeviatie, Geometrisch interval, Pretty breaks, Natural breaks (Jenks), Handmatig.
- De NDVI-overlay wordt **live herkleurd** volgens de gekozen klassegrenzen (`renderClassifiedNDVI`).
- Histogram gebruikt de **werkelijke data-range** i.p.v. de vaste schaal voor betere binning.

### Tussentijdse NDVI-export (Stap 3)
- **Veld-NDVI (GeoTIFF)** knop in een „Tussentijdse export“-kaart op stap 3.
- Exporteert de NDVI-clip van geselecteerde percelen als float32 GeoTIFF met CRS, GeoKeys en GDAL_NODATA=nan.
- Geen externe library nodig — de GeoTIFF wordt binair opgebouwd via `DataView`.

### Eenheden uitgebreid
- **11 eenheden** onder verdeeld in categorieën: massa/ha, volume/ha, oppervlakte-gebaseerd, aantallen/ha en algemeen.
- **Unit-hint** met omschrijving (bijv. „ⓘ kg/ha — vaste meststoffen“).
- **DDI-codes** in ISOXML-export correct per eenheid (kg → 0005, L → 0001, zaden → 0015, etc.).

### Legenda in het laagpaneel
- Aparte desktop-legenda verwijderd; de NDVI-legenda zit nu **in het ULC-paneel** (zowel desktop als mobiel).
- Gradient-kleuren worden **dynamisch gesynchroniseerd** met `ndviToRGB()` via `generateNdviGradientCss()`.
- Legend-labels frisser met 11px bold.

### Standaardklassen 5 → 7
- Uitbreiding van 5 naar 7 klassen met „Laag-midden“ en „Hoog-midden“.
- **ColorBrewer RdYlGn 7-kleurenpalet** voor maximaal visueel contrast.

### Auto-classificatie bij resolutie-wijziging
- Na het wijzigen van de resolutie wordt `autoClassifyFromData()` aangeroepen zodat klassen meteen passen bij de nieuwe data.
- Na perceelselectie wordt automatisch doorgegaan naar stap 4 (Data Analyse).

### Loading detail
- Extra `setLoadingDetail()`-regel onder de spinner (bijv. bestandsnaam + resolutie, gridinfo).

### ZIP-generatie fix
- Bugfix in `buildZipBlob`: byte-order van ZIP handtekeningen stond onjuist (big-endian i.p.v. little-endian). Lokale header, central directory en EOCD gebruiken nu consistent `true` (little-endian).

### i18n uitbreiding
- Alle nieuwe labels, eenheden, class-namen, toast-berichten, navigatieknoppen en classificatiemethoden vertaald (NL/EN).
