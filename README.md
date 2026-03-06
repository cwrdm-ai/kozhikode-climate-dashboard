# Susthira — Kozhikode Climate Projection Dashboard

> *An interactive, panchayat-level climate data dashboard for Kozhikode District, Kerala — powered by CORDEX South Asia regional climate model outputs and area-weighted spatial interpolation.*

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Project Structure](#project-structure)
3. [CORDEX Data Overview](#cordex-data-overview)
   - [What is CORDEX?](#what-is-cordex)
   - [Dataset Details](#dataset-details)
   - [File Naming Convention](#file-naming-convention)
4. [Preprocessing Pipeline](#preprocessing-pipeline)
   - [Step 1 — Load GeoJSON Polygons](#step-1--load-geojson-polygons)
   - [Step 2 — Build CORDEX Grid Cell Polygons](#step-2--build-cordex-grid-cell-polygons)
   - [Step 3 — Area-Weighted Interpolation](#step-3--area-weighted-interpolation)
   - [Step 4 — Extract & Interpolate Climate Data](#step-4--extract--interpolate-climate-data)
   - [Step 5 — Ensemble Mean & Merge Scenarios](#step-5--ensemble-mean--merge-scenarios)
5. [Output JSON File](#output-json-file)
   - [JSON Structure](#json-structure)
   - [Variables Stored in the JSON](#variables-stored-in-the-json)
   - [Derived Variables](#derived-variables)
6. [GeoJSON File](#geojson-file)
7. [Dashboard — Charts and Visualisation](#dashboard--charts-and-visualisation)
   - [Technologies Used](#technologies-used)
   - [Chart Descriptions](#chart-descriptions)
   - [Choropleth Map](#choropleth-map)
   - [Rainwater Harvesting Calculator](#rainwater-harvesting-calculator)
8. [Climate Variables Explained](#climate-variables-explained)
9. [Running the Preprocessing Script](#running-the-preprocessing-script)
10. [Running the Dashboard](#running-the-dashboard)
11. [Dependencies](#dependencies)

---

## Project Overview

**Susthira** is a static browser-based climate projection dashboard built for Kozhikode District, Kerala. It gives panchayat-level climate insights from 2000 to 2100, drawn from the CORDEX South Asia regional climate model ensemble.

The dashboard covers all **78 local-authority administrative units** of Kozhikode District:

| Type | Count |
|---|---|
| Grama Panchayats | 70 |
| Municipalities | 7 |
| Municipal Corporation | 1 |
| **Total** | **78** |

Users can:
- Select any local body from a dropdown or by clicking on the map
- Toggle between **RCP 2.6** (low emissions) and **RCP 8.5** (high emissions) future scenarios
- Scrub through years 2000–2099 using a year slider
- View annual and monthly trend charts for rainfall, temperature, DTR, and comfort index
- Calculate projected rainwater harvesting potential for any year

---

## Project Structure

```
cordex-180226/
│
├── Monthly/                        # Raw CORDEX NetCDF files (.nc) — monthly data
│   └── *.nc                        # e.g. pr_WAS-22_MOHC-HadGEM2-ES_rcp85_...nc
│
├── dashboard/                      # Static web dashboard (open index.html to run)
│   ├── index.html                  # Main dashboard page
│   ├── app.js                      # Dashboard JavaScript — chart logic, map, interactions
│   ├── style.css                   # Dashboard styling
│   ├── kozhikode_climate_data.json # Pre-processed climate data (output of pipeline)
│   ├── kozhikode_panchayats.geojson# Administrative boundary polygons (OSM)
│   ├── preprocess_kozhikode_v2.py  # Copy of preprocessing script (for reference)
│   ├── analyze_geojson.py          # GeoJSON analysis utility
│   └── geojson_analysis.txt        # Output of GeoJSON analysis
│
├── preprocess_kozhikode_v2.py      # Main preprocessing script (run this)
├── preprocess_kozhikode.py         # Earlier version of preprocessing script
├── check_data.py                   # Data verification/sanity-check script
├── check_result.json               # Output of check_data.py
├── check_output.txt                # Additional verification output
├── preprocess_log.txt              # Log from a preprocessing run
└── README.md                       # This file
```

---

## CORDEX Data Overview

### What is CORDEX?

**CORDEX** (Coordinated Regional Climate Downscaling Experiment) is an international framework that produces high-resolution regional climate projections by dynamically downscaling Global Climate Model (GCM) outputs using Regional Climate Models (RCMs).

This project uses the **CORDEX South Asia** domain:
- **Domain code**: `WAS-22`
- **Approximate grid resolution**: ~22 km (0.22°), which produces a grid of roughly 12 km at the native rotated-pole coordinates

### Dataset Details

| Attribute | Value |
|---|---|
| Domain | South Asia (`WAS-22`) |
| Approximate resolution | ~22 km |
| Time coverage | ~1950–2100 (historical + future) |
| Time frequency | Monthly |
| Variables used | `pr`, `tas`, `tasmax`, `tasmin` |
| Scenarios | `historical`, `rcp26`, `rcp85` |
| Grid type | Rotated-pole curvilinear (`rlat` × `rlon`) with companion `lat`/`lon` 2D arrays |

The raw data files are stored in the `Monthly/` directory as NetCDF (`.nc`) files. Each file covers one variable, one model (GCM + RCM pairing), one scenario, and a multi-year time range.

### How the CORDEX NetCDF Files Were Downloaded

The CORDEX NetCDF files were downloaded from the **Earth System Grid Federation (ESGF)** — the global federated infrastructure for distributing CMIP and CORDEX climate model outputs.

**Primary data portal used:**  
🌐 **[https://esgf-data.dkrz.de/](https://esgf-data.dkrz.de/)** — DKRZ (Deutsches Klimarechenzentrum / German Climate Computing Centre), Hamburg

**Steps to download:**
1. Go to the ESGF portal: [https://esgf-data.dkrz.de/search/cordex/](https://esgf-data.dkrz.de/search/cordex/)
2. Apply search filters:
   - **Project:** CORDEX
   - **Domain:** `WAS-22` (South Asia)
   - **Variable:** `pr`, `tas`, `tasmax`, `tasmin`
   - **Frequency:** `mon` (monthly)
   - **Experiment:** `historical`, `rcp26`, `rcp85`
3. Select the desired GCM–RCM model combinations
4. Click **"Show Files"** → **"wget script"** to generate a download script
5. Run the downloaded bash script: `bash wget_script_<date>.sh`

**Download scripts in this repository:**

| Script | Generated on | Contents |
|---|---|---|
| `wget_script_2026-2-25_10-48-8.sh` | 2026-02-25 | CORDEX `pr`, `tas`, `tasmax`, `tasmin` files |
| `wget_script_2026-2-27_12-38-11.sh` | 2026-02-27 | Additional `hurs` (relative humidity) files |

These scripts were generated at `esgf-data.dkrz.de` and contain direct download URLs with SHA256 checksums for data integrity verification. Each URL follows the THREDDS file server pattern:

```
http://esgf1.dkrz.de/thredds/fileServer/cordex_l02/cordex/output/{domain}/{institution}/{GCM}/{scenario}/{ensemble}/{RCM}/{version}/mon/{variable}/{date_version}/{filename}.nc
```

**Data nodes used:**
- `esgf1.dkrz.de` — DKRZ ESGF data node (CLMcom-ETH / COSMO-crCLIM models)
- `esgf-ictp.hpc.cineca.it` — ICTP/CINECA data node (ORNL / RegCM4-7 models)

### File Naming Convention

CORDEX files follow this naming pattern:

```
{var}_WAS-22_{GCM}_{scenario}_{ensemble}_{RCM}_{version}_mon_{startYYYYMM}-{endYYYYMM}.nc
```

**Example:**
```
pr_WAS-22_MOHC-HadGEM2-ES_rcp85_r1i1p1_IITM-RegCM4-4_v1_mon_200601-210012.nc
```

| Component | Meaning |
|---|---|
| `pr` | Variable (precipitation) |
| `WAS-22` | CORDEX South Asia domain, ~22 km |
| `MOHC-HadGEM2-ES` | Driving GCM (Met Office Hadley Centre) |
| `rcp85` | Scenario (RCP 8.5 — high emissions) |
| `r1i1p1` | Ensemble member |
| `IITM-RegCM4-4` | Regional Climate Model (IIT Madras, RegCM4) |
| `v1` | Version |
| `mon` | Monthly frequency |
| `200601-210012` | Date range (Jan 2006 – Dec 2100) |

The preprocessing script automatically parses this filename to identify the variable, scenario, and a composite `model_id = {GCM}__{RCM}`.

---

## Preprocessing Pipeline

The main preprocessing script is **`preprocess_kozhikode_v2.py`**. It reads the raw CORDEX NetCDF files, performs area-weighted spatial interpolation for each of the 78 local-authority polygons, computes derived variables, and outputs a single JSON file consumed by the dashboard.

### Step 1 — Load GeoJSON Polygons

```python
panchayats = load_grama_panchayats(GEOJSON_PATH)
```

The GeoJSON file (`kozhikode_panchayats.geojson`) contains administrative boundary polygons sourced from **OpenStreetMap** via Overpass Turbo. The script filters features using two criteria:
- `admin_level == "8"` — district sub-unit level
- `local_authority:IN` ∈ `{gram_panchayat, municipality, municipal_corporation}`

For each qualifying feature, the script extracts:
- `name` — the English name
- `local_authority_type` — admin category
- `geom` — a Shapely geometry object (Polygon or MultiPolygon)
- `centroid_lat`, `centroid_lon` — geographic centroid

**Result:** 78 admin unit records (70 gram panchayats + 7 municipalities + 1 municipal corporation).

### Step 2 — Build CORDEX Grid Cell Polygons

```python
grid_cells = build_grid_cell_polygons(lat2d, lon2d, BBOX)
```

CORDEX data uses a **rotated-pole curvilinear grid**. Each grid point has associated 2D `lat` and `lon` arrays. The script constructs a rectangular Shapely `box` polygon for each relevant grid cell by computing the midpoints between neighbouring grid points:

```
lat_lo = midpoint(lat[ri-1, ci], lat[ri, ci])   # southern edge
lat_hi = midpoint(lat[ri, ci], lat[ri+1, ci])   # northern edge
lon_lo = midpoint(lon[ri, ci-1], lon[ri, ci])   # western edge
lon_hi = midpoint(lon[ri, ci], lon[ri, ci+1])   # eastern edge
```

A bounding box `BBOX = (75.0, 10.8, 76.6, 12.0)` (lon_min, lat_min, lon_max, lat_max), padded by 0.3°, restricts the search to the Kozhikode region, reducing computation time significantly.

### Step 3 — Area-Weighted Interpolation

```python
panchayat_weights = compute_panchayat_weights(panchayats, grid_cells)
```

This is the core scientific method. For each panchayat polygon **P** and each nearby CORDEX grid cell **C_i** with climate value **V_i**:

```
                area( intersection(P, C_i) )
    w_i  =  ────────────────────────────────
                         area(P)
```

The area-weighted climate value for the panchayat is:

```
    Climate value  =  Σ  w_i · V_i
```

Where the sum is over all grid cells that overlap the panchayat. The weights are then **normalised** so they sum to 1.0, ensuring that boundary panchayats (which may not be fully covered by grid cells) produce physically consistent values:

```python
# Normalise weights to sum to 1
total_w = sum(w for _, _, w in cell_weights)
cell_weights = [(ri, ci, w / total_w) for ri, ci, w in cell_weights]
```

**Fallback:** If a panchayat has no overlapping grid cells (e.g., a very small urban polygon), the script falls back to nearest-centroid assignment.

**Why area-weighting matters:**  
Simple point-in-polygon or nearest-neighbour methods assign a single grid cell's value to the entire panchayat. Area-weighting is more accurate because it accounts for the fact that larger panchayats may span multiple ~22 km grid cells, each contributing a proportional share of the spatial area.

This weight computation is performed **once** (it is geometrically expensive, taking ~1–2 minutes for all 78 units) and the weights are reused for every variable and every time step.

**Example weights output (printed during run):**
```
Kunnamangalam: [cell(15,8)=62.31%, cell(15,9)=37.69%]
Thamarassery: [cell(16,9)=100.00%]
Kattippara:   [cell(17,10)=54.22%, cell(18,10)=45.78%]
```

### Step 4 — Extract & Interpolate Climate Data

```python
data = extract_panchayat_data(files, variable, panchayat_weights)
```

For each NetCDF file:
1. The variable data array is loaded — shape: `(time, rlat, rlon)`.
2. For each time step and each panchayat, the area-weighted value is computed:
   ```python
   val = sum(w * data[t_idx, ri, ci] for ri, ci, w in cell_weights)
   ```
3. Unit conversions are applied:
   - **`pr`**: `kg m⁻² s⁻¹` → `mm/month`  
     `val = val × 86400 × days_in_month`
   - **`tas`, `tasmax`, `tasmin`**: Kelvin → Celsius  
     `val = val − 273.15`

The function returns a list of `(year, month, value)` tuples for each panchayat.

### Step 5 — Ensemble Mean & Merge Scenarios

For each `(variable, scenario)` combination, multiple model runs may exist. Their monthly values are averaged to produce a **multi-model ensemble mean**:

```python
ensemble_mean[panchayat][(year, month)] = mean(values_from_all_models)
```

**Historical + Future Merge:**  
A continuous 2000–2100 time series is constructed by splicing:
- Historical data for years ≤ 2005
- RCP 2.6 or RCP 8.5 future data for years ≥ 2006

This splice point (2005/2006) is the standard CORDEX boundary between historical and future experiment periods.

**Derived variables computed per year:**

| Variable | Formula |
|---|---|
| `annual_pr` | Sum of 12 monthly precipitation values (mm/year) |
| `annual_tas` | Mean of 12 monthly mean temperatures (°C) |
| `annual_dtr` | Mean of monthly (tasmax − tasmin) values (°C) |
| `annual_comfort` | Mean of monthly Discomfort Index (see below) |
| `baseline_pr` | Mean annual `pr` over 1981–2005 |
| `baseline_tas` | Mean annual `tas` over 1981–2005 |

**Discomfort Index (DI)** per month, using Thom's formula:

```
DI = T  −  (0.55 − 0.0055 × RH) × (T − 14.5)
```

Where `T` = monthly mean temperature (°C) and `RH = 75%` (assumed constant, representative of Kozhikode's tropical coastal climate).

---

## Output JSON File

### JSON Structure

The preprocessing script produces `dashboard/kozhikode_climate_data.json` (~12 MB). Its top-level structure is:

```json
{
  "panchayats": ["Balussery", "Chelannur", ...],       // 70 grama panchayat names
  "urban_units": ["Feroke", "Kozhikode", ...],          // 8 urban bodies
  "panchayat_coords": {
    "Balussery": { "lat": 11.35420, "lon": 75.81200, "type": "gram_panchayat" },
    ...
  },
  "scenarios": {
    "rcp26": {
      "Balussery": { ... },
      "Chelannur": { ... },
      ...
    },
    "rcp85": {
      "Balussery": { ... },
      ...
    }
  }
}
```

### Variables Stored in the JSON

For each panchayat under each scenario, the data object has the following keys:

| Key | Type | Description |
|---|---|---|
| `monthly_pr` | `{ "YYYY": { "M": value } }` | Monthly precipitation (mm/month), by year and month number |
| `monthly_tas` | `{ "YYYY": { "M": value } }` | Monthly mean temperature (°C), by year and month |
| `monthly_dtr` | `{ "YYYY": { "M": value } }` | Monthly diurnal temperature range (°C), by year and month |
| `annual_pr` | `{ "YYYY": value }` | Annual total precipitation (mm/year) |
| `annual_tas` | `{ "YYYY": value }` | Annual mean temperature (°C) |
| `annual_dtr` | `{ "YYYY": value }` | Annual mean DTR (°C) |
| `annual_comfort` | `{ "YYYY": value }` | Annual mean Discomfort Index |
| `baseline_pr` | `number` | Mean annual precipitation over 1981–2005 (mm/year) |
| `baseline_tas` | `number` | Mean annual temperature over 1981–2005 (°C) |

Month keys are stored as **integer strings** (e.g., `"1"` for January through `"12"` for December).  
Year keys are **4-digit strings** (e.g., `"2050"`).

**Example snippet (Chelannur, RCP 2.6):**
```json
{
  "monthly_pr": {
    "2050": { "1": 8.4, "2": 5.1, "6": 612.3, "7": 753.1, ... }
  },
  "annual_pr": { "2050": 3012.4 },
  "annual_tas": { "2050": 27.82 },
  "annual_dtr": { "2050": 5.41 },
  "annual_comfort": { "2050": 26.7 },
  "baseline_pr": 2845.1,
  "baseline_tas": 27.01
}
```

### Derived Variables

The following variables are computed during preprocessing and stored in the JSON (not extracted directly from CORDEX):

| Derived Variable | Source Variables | Formula | Unit |
|---|---|---|---|
| `annual_dtr` | `tasmax`, `tasmin` | `mean(tasmax_m − tasmin_m)` for 12 months | °C |
| `monthly_dtr` | `tasmax`, `tasmin` | `tasmax_m − tasmin_m` per month | °C |
| `annual_comfort` | `tas` | Thom's DI using fixed RH = 75% | dimensionless |
| `baseline_pr` | `pr` | Mean over 1981–2005 | mm/year |
| `baseline_tas` | `tas` | Mean over 1981–2005 | °C |

> **Note:** `monthly_tasmax` and `monthly_tasmin` are intermediate variables used only to compute DTR; they are **deleted from the output** before saving to keep the JSON size manageable.

---

## GeoJSON File (Boundary Shapefile)

**File:** `dashboard/kozhikode_panchayats.geojson`  
**Size:** ~2.1 MB  
**Extracted on:** 2026-02-21

### Source: OpenStreetMap via Overpass Turbo

The administrative boundary polygons for all Kozhikode local bodies were downloaded as a **GeoJSON** from **[OpenStreetMap (OSM)](https://www.openstreetmap.org/)** using the **[Overpass Turbo](https://overpass-turbo.eu/)** web tool — a query interface for the OSM Overpass API.

#### How to Re-download / Reproduce

1. Navigate to **[https://overpass-turbo.eu/](https://overpass-turbo.eu/)**
2. Enter an Overpass QL query targeting Kozhikode District administrative boundaries:

```overpassql
[out:json][timeout:60];
// Kozhikode district relation
rel(3388282);
// Get all admin_level=8 sub-relations (panchayats, municipalities, corporation)
rel(r)[admin_level=8];
// Recurse to get full geometry
(._;>;);
out body;
```

3. Click **Run**, then **Export → GeoJSON**
4. Save the file as `kozhikode_panchayats.geojson`

> **Alternative:** Use the Overpass API directly via:  
> `https://overpass-api.de/api/interpreter?data=<encoded_query>`

#### Why OSM?

OpenStreetMap provides crowd-sourced, freely licensed administrative boundaries for India's local self-government units. For Kozhikode, OSM includes all 78 local bodies tagged with the standard `local_authority:IN` key, which this project uses to filter panchayats, municipalities, and the municipal corporation.

#### GeoJSON Structure

The downloaded file contains **436 features** in total (including waterways, roads, and points). The preprocessing script filters exclusively on:
- `admin_level == "8"` AND `local_authority:IN` ∈ `{gram_panchayat, municipality, municipal_corporation}`

This yields exactly **78 polygon features** used for interpolation.

| Geometry type | Count |
|---|---|
| Polygon | 77 |
| MultiPolygon | 1 |

**Key OSM properties used:**

| Property | Description |
|---|---|
| `name` | English name of the local body |
| `local_authority:IN` | Type: `gram_panchayat`, `municipality`, or `municipal_corporation` |
| `admin_level` | OSM administrative level (`"8"` = sub-district / local body) |
| `name:ml` | Name in Malayalam (available for most features) |
| `wikidata` | Wikidata QID (links to Wikipedia / Wikidata entries) |

**GeoJSON analysis script:** `dashboard/analyze_geojson.py` reads the file and produces `geojson_analysis.txt`, summarising property key distribution, geometry types, admin level counts, and the full list of all 78 unit names.

---

## Dashboard — Charts and Visualisation

### Technologies Used

| Technology | Purpose |
|---|---|
| **HTML / CSS / JavaScript** | Static web app, no backend required |
| **Chart.js 4.4.1** | All trend and bar charts |
| **chartjs-plugin-annotation 3.0.1** | Reference lines on the Comfort Index chart |
| **Leaflet.js 1.9.4** | Interactive choropleth map |
| **Google Fonts (Inter, Outfit)** | Typography |

The dashboard is entirely **client-side and static** — it can be run by simply opening `dashboard/index.html` in a browser, or served from any static web host (GitHub Pages, Netlify, etc.).

Data is loaded asynchronously at startup:
```javascript
const [climateResp, geojsonResp] = await Promise.all([
    fetch('kozhikode_climate_data.json'),
    fetch('kozhikode_panchayats.geojson'),
]);
```

### Chart Descriptions

#### 1. Annual Rainfall Trend

- **Type:** Line chart
- **X-axis:** Year (2000–2099)
- **Y-axis:** Rainfall (mm/year)
- **Datasets:**
  - Solid cyan line — annual precipitation for the selected local body and scenario
  - Dashed amber line — baseline mean (1981–2005)
- **Tooltip:** Shows exact mm value on hover; uses `mode: 'index'` for synchronised vertical crosshair

#### 2. Monthly Rainfall

- **Type:** Bar chart
- **X-axis:** Month (Jan–Dec)
- **Y-axis:** mm/month for the selected year (controlled by year slider)
- **Features:** Colour-coded bars — deeper blue = heavier rainfall; pale cyan = dry months

#### 3. Temperature Trend & ΔT

- **Type:** Dual-axis line chart
- **Y-axis (left):** Mean annual temperature (°C), with baseline reference line
- **Y-axis (right):** ΔT — temperature anomaly from the 1981–2005 baseline (°C)
- **Datasets:**
  - Amber line — mean temperature
  - Red dashed line — ΔT anomaly
  - Grey dashed line — baseline level
- **Tooltip:** Formatted to 2 decimal places in °C

#### 4. Diurnal Temperature Range (DTR)

- **Type:** Line chart (purple, filled)
- **X-axis:** Year
- **Y-axis:** Annual mean DTR (°C) = `mean(tasmax − tasmin)` over 12 months
- **Purpose:** Tracks how the day–night temperature difference changes over the century

#### 5. Comfort Index (Discomfort Index — DI)

- **Type:** Line chart (red, filled)
- **X-axis:** Year
- **Y-axis:** Annual mean DI value
- **Annotation lines** at DI = 21, 24, 27 with colour-coded threshold labels:
  - **< 21** — Comfortable (green)
  - **21–24** — Mild Discomfort (amber)
  - **24–27** — Discomfort (orange)
  - **≥ 27** — Severe Discomfort (red)
- **Tooltip:** Appends comfort category label to the DI value

**Chart.js performance optimisations:**
- All trend charts use `animation: false` to avoid rerender lag when switching panchayats
- All charts share a custom `xScrubTooltip` plugin that activates tooltip using position-based index calculation (rather than point hit-testing), making scrubbing smooth across all 100 data points
- Interaction mode `'index', intersect: false` ensures entire vertical column highlights on hover

### Choropleth Map

The interactive map is powered by **Leaflet.js** with an OpenStreetMap tile base layer, centred on Kozhikode District (11.42°N, 75.78°E).

**Two separate GeoJSON layers** are added:
- **Gram Panchayat layer** — solid borders, choropleth fill
- **Municipality/Corporation layer** — dashed orange borders (municipalities) or dashed purple borders (corporation)

**Choropleth colouring** can be toggled between:
- 🌧 **Rainfall mode** — cyan gradient (pale = low, deep blue = > 3500 mm/year)
- 🌡 **Temperature mode** — warm gradient (green = cooler, dark red = > 29°C)

Colours update automatically when the year slider is moved. Clicking any polygon selects that local body and refreshes all charts.

### Rainwater Harvesting Calculator

A practical tool embedded in the dashboard. User inputs:
- **Roof area** (m²)
- **Roof material** → automatically sets runoff coefficient:

| Material | Runoff coefficient |
|---|---|
| Concrete | 0.85 |
| GI / Fibre sheet | 0.80 |
| Tile | 0.75 |
| Asbestos | 0.70 |
| Organic | 0.60 |

**Calculation:**
```
Harvest (litres) = Annual Rainfall (mm) × Roof Area (m²) × Runoff coefficient
Daily average    = Harvest / 365
Δ from baseline  = (Harvest − Baseline Harvest) / Baseline Harvest × 100%
```

The rainfall value used is the projected annual total for the **currently selected year and scenario**, enabling a year-by-year assessment of future harvesting potential.

---

## Climate Variables Explained

| Variable | CORDEX Name | Unit (raw) | Unit (dashboard) | Description |
|---|---|---|---|---|
| Precipitation | `pr` | kg m⁻² s⁻¹ | mm/month, mm/year | Monthly total rainfall |
| Mean temperature | `tas` | K | °C | Monthly mean near-surface air temperature |
| Maximum temperature | `tasmax` | K | °C (intermediate) | Monthly mean of daily maximum temperature |
| Minimum temperature | `tasmin` | K | °C (intermediate) | Monthly mean of daily minimum temperature |
| Diurnal Temp Range | DTR (derived) | — | °C | `tasmax − tasmin` per month |
| Discomfort Index | DI (derived) | — | — | Thom's formula with assumed RH = 75% |
| Baseline precipitation | — | — | mm/year | 1981–2005 ensemble-mean annual average |
| Baseline temperature | — | — | °C | 1981–2005 ensemble-mean annual average |

### RCP Scenarios

| Scenario | Name | Description |
|---|---|---|
| RCP 2.6 | Low emissions | Strong mitigation; global temperature increase stays below 2°C by 2100 |
| RCP 8.5 | High emissions | Business-as-usual; temperature rise of 4–5°C by 2100 |

Both scenarios use identical historical data up to 2005 and diverge from 2006 onwards.

---

## Running the Preprocessing Script

> **Note:** This step is only required if you want to regenerate the data from raw NetCDF files. The output JSON (`kozhikode_climate_data.json`) is already included in the repository.

### Prerequisites

```bash
pip install numpy xarray shapely
```

Or if using the project's virtual environment:
```bash
.venv\Scripts\activate   # Windows
pip install numpy xarray shapely
```

### Execution

From the project root directory:

```bash
python preprocess_kozhikode_v2.py
```

**Expected output (5 stages):**
```
=================================================================
CORDEX Data Preprocessing — Kozhikode Admin Units (v3)
Units: 70 GP + 7 Municipalities + 1 Corporation = 78 total
Method: Area-Weighted Grid Cell Interpolation (Shapely)
=================================================================

[1/5] Loading grama panchayat polygons from GeoJSON...
  Loaded 78 admin units from GeoJSON: {'gram_panchayat': 70, 'municipality': 7, 'municipal_corporation': 1}

[2/5] Building CORDEX grid cell polygons...
  Built N grid cells covering Kozhikode area

[3/5] Computing area-weighted overlaps for each panchayat...
  (This is a one-time calculation — may take ~1-2 minutes)
  Done. Weights computed for 78 panchayats

[4/5] Extracting & interpolating climate data from NetCDF files...

[5/5] Merging historical + RCP, computing derived variables...
  Saved: .../dashboard/kozhikode_climate_data.json (12.0 MB)
```

**Expected runtime:** 5–20 minutes depending on the number of NetCDF files and CPU speed. The area-weight computation (step 3) runs once; data extraction (step 4) iterates over all files.

### Data Verification

After preprocessing, verify the output:

```bash
python check_data.py
```

This reads the JSON and writes `check_result.json` with:
- Total number of panchayats
- Count of unique baseline precipitation and temperature values (should equal 78 — confirming each panchayat has its own area-weighted baseline)
- Sample values for 8 well-distributed panchayats

---

## Running the Dashboard

The dashboard is a **static website** — no server or backend is required.

**Option 1 — Open directly in browser:**
```
Open:  dashboard/index.html
```

**Option 2 — Serve locally (recommended to avoid CORS issues with large JSON):**
```bash
cd dashboard
python -m http.server 8080
# Then open http://localhost:8080 in your browser
```

**Option 3 — Deploy to static host:**
Upload the contents of the `dashboard/` folder to GitHub Pages, Netlify, Vercel, or any static file host.

---

## Dependencies

### Python (preprocessing)

| Package | Purpose |
|---|---|
| `numpy` | Numerical arrays, mean, argmin |
| `xarray` | NetCDF reading (`open_dataset`) |
| `shapely` | Polygon geometry, intersection area |
| `json` | JSON serialization |
| `glob`, `os`, `calendar` | File discovery, path handling, days-per-month |

Standard library: `math`, `collections.defaultdict`

### JavaScript (dashboard)

| Library | Version | CDN |
|---|---|---|
| Chart.js | 4.4.1 | jsdelivr |
| chartjs-plugin-annotation | 3.0.1 | jsdelivr |
| Leaflet.js | 1.9.4 | unpkg |
| Google Fonts (Inter, Outfit) | — | fonts.googleapis.com |

---

## Data Sources & Acknowledgements

- **Climate Data:** CORDEX South Asia (WAS-22) multi-model ensemble, distributed via the Earth System Grid Federation (ESGF)
- **Administrative Boundaries:** OpenStreetMap contributors, extracted via Overpass Turbo
- **Comfort Index:** Thom, E.C. (1959). "The discomfort index." *Weatherwise*, 12(2), 57–60

---

*Dashboard title: **Susthira** (സുസ്ഥിര) — Malayalam for "sustainable"*
