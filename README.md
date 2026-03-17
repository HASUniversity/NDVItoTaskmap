# 🌾 NDVI Taakkaart Generator

> **NL** | [EN](#english)

Een browser-gebaseerde tool om variabele-dosering taakkaarten te genereren vanuit multispectrale NDVI GeoTIFF-opnames van drones.

**Geen server, geen installatie, geen account** — open `index.html` en begin.

---

## Functies

* **GeoTIFF upload** — Ondersteuning voor WebODM/ODM multispectrale beelden, pre-berekende NDVI en DJI Terra RGB Plant Health exports.
* **Automatische banddetectie** — Detecteert Red, Green, NIR en RedEdge via golflengte-metadata of ODM-conventie; handmatige override mogelijk.
* **Meerdere vegetatie-indexen** — NDVI, GNDVI, NDRE, SAVI en OSAVI. Selecteer de index in de UI; de juiste banden worden automatisch geselecteerd.
* **Instelbare resolutie** — Slider van 512–8192 px bepaalt op welke resolutie het raster geladen wordt. Hogere waarden geven nauwkeurigere indexberekeningen.
* **Parcel clipping** — NDVI-overlay en histogram worden automatisch geknipt naar geselecteerde percelen. Kleuren en schaal blijven consistent met het volledige raster.
* **BRP perceelintegratie** — Laadt live Nederlandse perceelgrenzen via PDOK WFS; selecteer percelen door erop te klikken.
* **Gewashistorie** — Toont jaarlijkse gewasregistraties per perceel op basis van BRP-data.
* **NDVI-histogram** — Visuele verdeling van indexwaarden over het perceel met klasgrenzen.
* **Auto-classificatie** — Verdeelt klassen automatisch op basis van gelijke NDVI-oppervlakte.
* **Rijrichting** — Noord-Zuid knop of automatische optimale rijrichting op basis van de langste perceelzijde; realtime taakkaart preview.
* **Exportformaten** — Shapefile, ISOXML TaskData, GeoJSON en CSV (zie tabel hieronder).
* **Offline bruikbaar** — Alle vendor-libraries zijn gebundeld; na clone is geen internet nodig (PDOK data wel live).

---

## Exportformaten

| Formaat | Bestandsnaam | Compatibel met |
| --- | --- | --- |
| **Shapefile** | `naam.zip` | ArcGIS, QGIS, John Deere Operations Center, Trimble Ag Software, CNH AFS |
| **ISOXML TaskData** | `naam_TASKDATA.zip` | ISOBUS task controllers — John Deere, Fendt, Claas, AGCO, CNH, Topcon, Trimble |
| **GeoJSON** | `naam.geojson` | Web-GIS, Mapbox, QGIS, Leaflet |
| **CSV** | `naam.csv` | Excel, FMIS, Agromanager, elke spreadsheet |

Het ISOXML-formaat implementeert ISO 11783-10 (TASKDATA.XML + GRD-binair grid) en is direct inlaadbaar op ISOBUS-compatibele tractor-terminals.

---

## Ondersteunde GeoTIFF-typen

| Type | Detectiemethode |
| --- | --- |
| WebODM / ODM 5-band | Golflengte-metadata (NIR 840 nm, R 650 nm, etc.) |
| DJI Mavic Multispectral | Bandnaam-metadata (`Red`, `Nir`) |
| Generieke multispectrale TIF | Reflectantie-heuristiek (NIR heeft typisch de hoogste gemiddelde waarde) |
| Pre-berekende NDVI | 1-bands float32 GeoTIFF |
| DJI Plant Health / Terra export | RGB-kleurenkaart (proxy NDVI via G/R kanaalverhouding) |

---

## Technologie

| Library | Doel |
| --- | --- |
| [Leaflet.js](https://leafletjs.com/) | Interactieve kaartvisualisatie |
| [GeoTIFF.js](https://geotiffjs.github.io/) | TIFF-parsing met overview-aware lazy reading |
| [proj4js](https://github.com/proj4js/proj4js) | CRS-conversies (RD New, UTM, WGS84) |
| [Turf.js](https://turfjs.org/) | Ruimtelijke analyse — grids, intersectie, centroïde, oppervlakte |

Pure HTML, CSS en vanilla JavaScript — geen frameworks, geen Node.js, geen build-tooling.

---

## Snel starten

```bash
git clone https://github.com/HASUniversity/NDVItoTaskmap.git
cd NDVItoTaskmap
```

Open `index.html` direct in Chrome, Firefox of Edge. Geen lokale webserver vereist.

---

## Workflow

1. **GeoTIFF laden** — Sleep een multispectrale `.tif` in de browser of klik om te uploaden.
2. **Index & banden** — Kies een vegetatie-index (NDVI, GNDVI, NDRE, SAVI of OSAVI), stel de gewenste resolutie in en klik *Bereken*. Banden worden automatisch gedetecteerd.
3. **Percelen selecteren** — Zoom in tot niveau 14+; BRP-percelen laden automatisch. Klik een perceel om te selecteren. De overlay en het histogram worden automatisch geknipt naar het geselecteerde perceel.
4. **Taakkaart instellen** — Stel gridgrootte, eenheid, rijrichting en doseringsklassen in. Gebruik *auto-classificeer* voor gelijke verdeling over klassen.
5. **Exporteren** — Download in het gewenste formaat voor tractor-terminal of FMIS.

---

## Databronnen

Perceelgrenzen en gewasregistraties worden live opgehaald van [PDOK](https://www.pdok.nl/) via de [BRP Gewaspercelen WFS](https://service.pdok.nl/rvo/gewaspercelen/wfs/v1_0). Beschikbaarheid van historische data is afhankelijk van de RVO-publicatiecyclus.

---

## Licentie

[MIT](LICENSE) © 2026 Contributors — [github.com/HASUniversity/NDVItoTaskmap](https://github.com/HASUniversity/NDVItoTaskmap)

---

## English

> [NL](#-ndvi-taakkaart-generator) | **EN**

A browser-based tool for generating variable-rate prescription task maps from multispectral NDVI GeoTIFF drone imagery.

**No server, no build step, no account needed** — open `index.html` and go.

---

### Features

* **GeoTIFF upload** — Supports WebODM/ODM multispectral, pre-calculated NDVI, and DJI Terra RGB Plant Health exports.
* **Automatic band detection** — Detects Red, Green, NIR, and RedEdge via wavelength metadata or ODM convention; manual override available.
* **Multiple vegetation indices** — NDVI, GNDVI, NDRE, SAVI, and OSAVI. Select the index in the UI; the required bands are auto-selected.
* **Adjustable resolution** — Slider from 512–8192 px controls the raster loading resolution. Higher values give more accurate index calculations.
* **Parcel clipping** — The index overlay and histogram are automatically clipped to selected parcels. Colour scale and legend remain consistent with the full raster.
* **BRP parcel integration** — Loads live Dutch agricultural field boundaries via PDOK WFS; click to select parcels.
* **Crop history** — Displays annual crop registrations per parcel from BRP data.
* **Index histogram** — Visual distribution of index values across the parcel with class boundaries overlaid.
* **Auto-classify** — Divides classes automatically into equal-area index buckets.
* **Driving direction** — North-South button or auto-optimal direction based on the longest parcel edge; live task map preview.
* **Export formats** — Shapefile, ISOXML TaskData, GeoJSON, and CSV (see table below).
* **Fully offline-capable** — All vendor libraries bundled; no internet required after clone (except live PDOK data).

---

### Export Formats

| Format | Filename | Compatible with |
| --- | --- | --- |
| **Shapefile** | `name.zip` | ArcGIS, QGIS, John Deere Operations Center, Trimble Ag Software, CNH AFS |
| **ISOXML TaskData** | `name_TASKDATA.zip` | ISOBUS task controllers — John Deere, Fendt, Claas, AGCO, CNH, Topcon, Trimble |
| **GeoJSON** | `name.geojson` | Web GIS, Mapbox, QGIS, Leaflet |
| **CSV** | `name.csv` | Excel, FMIS, Agromanager, any spreadsheet |

ISOXML implements ISO 11783-10 (TASKDATA.XML + binary GRD grid) and is directly loadable on any ISOBUS-compatible tractor terminal.

---

### Supported GeoTIFF Types

| Type | Detection method |
| --- | --- |
| WebODM / ODM 5-band | Wavelength metadata (NIR 840 nm, R 650 nm, etc.) |
| DJI Mavic Multispectral | Band name metadata (`Red`, `Nir`) |
| Generic multispectral | Reflectance heuristic (NIR typically has the highest mean) |
| Pre-calculated NDVI | Single-band float32 GeoTIFF |
| DJI Plant Health / Terra | RGB colour map (proxy NDVI via G/R channel ratio) |

---

### Tech Stack

| Library | Purpose |
| --- | --- |
| [Leaflet.js](https://leafletjs.com/) | Interactive map visualisation |
| [GeoTIFF.js](https://geotiffjs.github.io/) | TIFF parsing with overview-aware lazy reading |
| [proj4js](https://github.com/proj4js/proj4js) | CRS conversions (RD New, UTM, WGS84) |
| [Turf.js](https://turfjs.org/) | Spatial analysis — grids, intersection, centroid, area |

Pure HTML, CSS, and vanilla JavaScript. No frameworks, no Node.js, no build tooling.

---

### Quick Start

```bash
git clone https://github.com/HASUniversity/NDVItoTaskmap.git
cd NDVItoTaskmap
```

Open `index.html` directly in Chrome, Firefox, or Edge. No local web server required.

---

### Workflow

1. **Load GeoTIFF** — Drag and drop a multispectral `.tif` into the browser or click to upload.
2. **Index & Bands** — Choose a vegetation index (NDVI, GNDVI, NDRE, SAVI, or OSAVI), set the desired resolution, and click *Calculate*. Bands are auto-detected.
3. **Select Parcels** — Zoom to level 14+; BRP parcels load automatically. Click a field to select. The overlay and histogram are automatically clipped to the selected parcel(s).
4. **Configure Task Map** — Set grid size, unit, driving direction, and dosage classes. Use *auto-classify* for equal index distribution across classes.
5. **Export** — Download in your preferred format for the tractor terminal or FMIS.

---

### Data Sources

Parcel boundaries and crop registrations are retrieved live from [PDOK](https://www.pdok.nl/) via the [BRP Gewaspercelen WFS](https://service.pdok.nl/rvo/gewaspercelen/wfs/v1_0). Historical data availability depends on the RVO publication cycle.

---

### License

[MIT](LICENSE) © 2026 Contributors — [github.com/HASUniversity/NDVItoTaskmap](https://github.com/HASUniversity/NDVItoTaskmap)