# 🌾 NDVItoTaskmap

A browser-based, open-source tool for generating variable-rate prescription maps (taakkaarten) from multispectral NDVI GeoTIFF images captured by drones.

**No server, no build step, no account needed** — open `index.html` and go.

---

## Features

* **Direct GeoTIFF upload** — Supports WebODM/ODM multispectral, pre-calculated NDVI, or DJI Terra RGB Plant Health exports.
* **Automatic band detection** — Detects Red / NIR via wavelength metadata or ODM conventions; manual override available.
* **BRP parcel integration** — Loads live Dutch agricultural field boundaries via PDOK WFS; select by clicking.
* **Crop history** — Displays annual crop registrations in the sidebar and legend based on BRP data.
* **Prescription map generation** — Variable-rate dosage grid, precisely clipped to the selected parcel geometry.
* **Grid optimization** — Calculates optimal driving direction by aligning the grid with the field's longest edge.
* **Export** — FMIS-ready Shapefile (`.zip`) and GeoJSON.
* **Fully offline-capable** — All vendor libraries are bundled; no internet required after the initial clone (except for live PDOK data).

---

## Tech Stack

| Library | Purpose |
| --- | --- |
| [Leaflet.js](https://leafletjs.com/) | Interactive map visualization |
| [GeoTIFF.js](https://geotiffjs.github.io/) | TIFF parsing with overview-aware lazy reading |
| [proj4js](https://github.com/proj4js/proj4js) | CRS conversions (RD New, UTM, WGS84) |
| [Turf.js](https://turfjs.org/) | Spatial analysis — grids, intersection, centroid |

Pure HTML, CSS, and vanilla JavaScript. No frameworks, no Node.js, no build tooling.

---

## Getting Started

```bash
git clone https://github.com/your-org/NDVItoTaskmap.git
cd NDVItoTaskmap

```

**Open directly:**
Double-click `index.html` to open the application in Chrome, Firefox, or Edge. No local webserver is required for the core functionality.

---

## Usage

1. **Load GeoTIFF** — Drag and drop a multispectral `.tif` into the browser or click to upload.
2. **Bands & NDVI** — Verify automatic detection; click *Calculate NDVI*.
3. **Select Parcels** — Zoom to level 14 or higher; BRP parcels load automatically. Click a field to select.
4. **Configure Task Map** — Set grid cell size, units, and optimal driving direction.
5. **Export** — Download the Shapefile for import into the tractor terminal or FMIS.

---

## Supported GeoTIFF Types

| Type | Detection Method |
| --- | --- |
| WebODM / ODM 5-band | Wavelength metadata (NIR 840 nm, R 650 nm, etc.) |
| DJI Mavic Multispectral | Band name metadata (`Red`, `Nir`) |
| Generic multispectral | Value-range heuristic (NIR typically has highest reflectance) |
| Pre-calculated NDVI | Single-band float32 GeoTIFF |

---

## Data Sources

Parcel boundaries and crop registrations are retrieved live from [PDOK](https://www.pdok.nl/) via the [BRP Gewaspercelen WFS](https://service.pdok.nl/rvo/gewaspercelen/wfs/v1_0). Historical data availability depends on the RVO publication cycle.

---

## License

[MIT](https://www.google.com/search?q=LICENSE) © 2026 Contributors