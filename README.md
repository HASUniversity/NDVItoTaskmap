# 🌾 Taakkaart Generator

A browser-based, open-source tool for generating variable-rate prescription maps (taakkaarten) from multispectral NDVI GeoTIFF images captured by drones.

**No server, no build step, no account needed** — open `index.html` and go.

---

## Features

- **GeoTIFF upload** — WebODM/ODM multispectral, pre-calculated NDVI, or RGB Plant Health exports (DJI Terra)
- **Automatic band detection** — detects Red / NIR by wavelength metadata or ODM naming convention; manual override always available
- **NDVI visualisation** — adaptive colour ramp rendered as a canvas overlay on an interactive Leaflet basemap
- **BRP parcel integration** — loads Dutch agricultural field boundaries live from PDOK WFS; click to select
- **Crop history per parcel** — shows per-year crop registrations in the sidebar and the map legend
- **Task map generation** — variable-rate dosering grid clipped precisely to selected parcel shapes
- **Grid rotation** — one-click optimal driving direction (aligns grid with the field's longest edge)
- **Export** — Shapefile `.zip` (FMIS-ready) and GeoJSON
- **Fully offline-capable** — all vendor libraries are bundled; no CDN calls after initial clone

---

## Tech Stack

| Library | Purpose |
|---|---|
| [Leaflet.js](https://leafletjs.com/) | Interactive slippy map |
| [GeoTIFF.js](https://geotiffjs.github.io/) | TIFF parsing with overview-aware lazy reading |
| [proj4js](https://github.com/proj4js/proj4js) | CRS conversions (RD New, UTM zones, WGS84) |
| [Turf.js](https://turfjs.org/) | Spatial analysis — grid, intersect, area, centroid |

Pure HTML + CSS + vanilla JavaScript. No framework, no Node.js, no build tooling.

---

## Getting Started

```bash
git clone https://github.com/your-org/taakkaart-generator.git
cd taakkaart-generator
```

**Option A — open directly** (works in most browsers):
```
# just open index.html in Chrome, Firefox, or Edge
```

**Option B — local server** (recommended, avoids any file:// quirks):
```bash
python -m http.server 8080   # Python 3
# or
npx serve .                  # Node.js
```
Open [http://localhost:8080](http://localhost:8080).

---

## Usage

1. **GeoTIFF laden** — drag & drop or click to upload a multispectral `.tif` from WebODM
2. **Banden & NDVI** — auto-detected; adjust Red/NIR selectors if needed, then click *Bereken NDVI*
3. **Percelen selecteren** — zoom to ≥ 14; BRP parcels load automatically; click a field to select it
4. **Taakkaart instellen** — set grid cell size, unit, and optimal driving direction
5. **Exporteren** — download Shapefile or GeoJSON for import in your FMIS

---

## Supported GeoTIFF Types

| Type | Detection method |
|---|---|
| WebODM / ODM 5-band | Wavelength metadata (B 450 nm · G 560 nm · NIR 840 nm · R 650 nm · RE 730 nm) |
| DJI Mavic Multispectral | Band name metadata (`Red`, `Nir`, `Rededge`, …) |
| Generic multispectral | Value-range heuristic (NIR has highest mean reflectance) |
| Pre-calculated NDVI | Single-band float32 GeoTIFF |
| RGB Plant Health export | RGB photo-interpretation with proxy NDVI `(G−R)/(G+R)` |

---

## BRP Data

Parcel boundaries and crop registrations are loaded live from [PDOK](https://www.pdok.nl/) via the [BRP Gewaspercelen WFS v1.0](https://service.pdok.nl/rvo/gewaspercelen/wfs/v1_0). Internet required for parcel data; historical data availability depends on what RVO publishes (typically current + previous year).

---

## Contributing

PRs welcome! For significant changes please open an issue first.

1. Fork → feature branch → commit → push → PR
2. Keep all vendor libraries in `static/vendor/` — no build pipeline by design

---

## License

[MIT](LICENSE) © 2026 Contributors
