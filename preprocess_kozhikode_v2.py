"""
Preprocess CORDEX South Asia data for Kozhikode District Admin Units.
Processes all 78 local-authority units: 70 Grama Panchayats +
7 Municipalities + 1 Municipal Corporation, using area-weighted
interpolation across CORDEX grid cells.

Method:
  For each grama panchayat polygon P:
    For each nearby CORDEX grid cell C_i with climate value V_i:
      w_i = area(intersection(P, C_i)) / area(P)
    Climate value = sum(w_i * V_i)   [only panchayat area is used; weights sum to 1]

Requires: shapely, xarray, numpy, json (all standard in scientific Python)
"""

import os
import glob
import json
import math
import numpy as np
import xarray as xr
import calendar
from collections import defaultdict
from shapely.geometry import shape, Polygon, MultiPolygon, box
from shapely.ops import unary_union

# ── Configuration ─────────────────────────────────────────────────────────────

DATA_DIR   = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Monthly")
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dashboard")
GEOJSON_PATH = os.path.join(OUTPUT_DIR, "kozhikode_panchayats.geojson")

# All local-authority admin units to process (gram panchayats + municipalities + corporation)
LOCAL_AUTHORITY_TYPES = {"gram_panchayat", "municipality", "municipal_corporation"}

# Variables to process
VARIABLES = ["pr", "tas", "tasmax", "tasmin"]

# Assumed relative humidity for Kozhikode (tropical coastal)
RH_KOZHIKODE = 75.0

# Bounding box to restrict grid cell search (slightly padded around district)
BBOX = (75.0, 10.8, 76.6, 12.0)   # (min_lon, min_lat, max_lon, max_lat)

# ── Load Grama Panchayats from GeoJSON ────────────────────────────────────────

def load_grama_panchayats(geojson_path):
    """
    Load all local-authority admin unit polygons from GeoJSON.
    Includes gram_panchayat (70), municipality (7), municipal_corporation (1).
    Returns list of dicts: [{name, local_authority_type, shapely_geom, centroid_lat, centroid_lon}, ...]
    """
    with open(geojson_path, "r", encoding="utf-8") as f:
        gj = json.load(f)

    panchayats = []
    for feat in gj["features"]:
        props = feat["properties"]
        # Filter: admin_level=8 AND one of our target local_authority types
        if props.get("admin_level") != "8":
            continue
        la_type = props.get("local_authority:IN", "")
        if la_type not in LOCAL_AUTHORITY_TYPES:
            continue
        name = props.get("name", "Unknown")
        geom = shape(feat["geometry"])
        centroid = geom.centroid
        panchayats.append({
            "name": name,
            "local_authority_type": la_type,
            "geom": geom,
            "centroid_lat": centroid.y,
            "centroid_lon": centroid.x,
        })

    type_counts = {}
    for p in panchayats:
        t = p["local_authority_type"]
        type_counts[t] = type_counts.get(t, 0) + 1
    print(f"  Loaded {len(panchayats)} admin units from GeoJSON: {type_counts}")
    return panchayats


# ── Build CORDEX Grid Cell Polygons ───────────────────────────────────────────

def build_grid_cell_polygons(lat2d, lon2d, bbox):
    """
    For each CORDEX grid point within bbox, construct a rectangular Shapely
    Polygon representing that cell's area (using midpoints between neighbors).

    Returns list of dicts: [{ri, ci, lat, lon, poly}, ...]
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    nrows, ncols = lat2d.shape
    cells = []

    # Pad the search slightly beyond bbox to capture boundary panchayats
    pad = 0.3  # degrees

    for ri in range(nrows):
        for ci in range(ncols):
            clat = lat2d[ri, ci]
            clon = lon2d[ri, ci]
            # Quick filter
            if not (min_lat - pad <= clat <= max_lat + pad and
                    min_lon - pad <= clon <= max_lon + pad):
                continue

            # Compute cell half-widths using midpoint to neighbors
            # Latitude edges
            lat_lo = (lat2d[ri - 1, ci] + clat) / 2 if ri > 0 else clat - 0.12
            lat_hi = (lat2d[ri + 1, ci] + clat) / 2 if ri < nrows - 1 else clat + 0.12

            # Longitude edges (note: lon increases along ci axis)
            lon_lo = (lon2d[ri, ci - 1] + clon) / 2 if ci > 0 else clon - 0.12
            lon_hi = (lon2d[ri, ci + 1] + clon) / 2 if ci < ncols - 1 else clon + 0.12

            poly = box(min(lon_lo, lon_hi), min(lat_lo, lat_hi),
                       max(lon_lo, lon_hi), max(lat_lo, lat_hi))
            cells.append({
                "ri": ri,
                "ci": ci,
                "lat": clat,
                "lon": clon,
                "poly": poly,
            })

    return cells


# ── Precompute Area Weights for Each Panchayat ────────────────────────────────

def compute_panchayat_weights(panchayats, grid_cells):
    """
    For each panchayat, find which grid cells overlap it and compute
    area-weighted fractions.

    Returns: dict {panchayat_name: [(ri, ci, weight), ...]}
    """
    weights = {}
    for p in panchayats:
        name = p["name"]
        geom = p["geom"]
        p_area = geom.area
        if p_area == 0:
            print(f"  WARNING: zero-area geometry for {name}, skipping")
            continue

        cell_weights = []
        for cell in grid_cells:
            if not cell["poly"].intersects(geom):
                continue
            try:
                intersection = cell["poly"].intersection(geom)
                inter_area = intersection.area
            except Exception:
                continue
            if inter_area > 0:
                w = inter_area / p_area
                cell_weights.append((cell["ri"], cell["ci"], w))

        # Normalise (handles edge panchayats where total weight < 1)
        total_w = sum(w for _, _, w in cell_weights)
        if total_w > 0:
            cell_weights = [(ri, ci, w / total_w) for ri, ci, w in cell_weights]
            weights[name] = cell_weights
        else:
            # Fallback: nearest cell centroid
            dists = [math.sqrt((cell["lat"] - p["centroid_lat"])**2 +
                               (cell["lon"] - p["centroid_lon"])**2)
                     for cell in grid_cells]
            nearest = grid_cells[int(np.argmin(dists))]
            weights[name] = [(nearest["ri"], nearest["ci"], 1.0)]
            print(f"  WARNING: no overlap found for {name}, using nearest cell")

    return weights


# ── Parse Filename ─────────────────────────────────────────────────────────────

def parse_filename(fname):
    """
    Parse CORDEX filename to extract variable, scenario, model_id.
    Pattern: {var}_WAS-22_{GCM}_{scenario}_{ensemble}_{RCM}_{version}_mon_{dates}.nc
    """
    base = os.path.basename(fname).replace(".nc", "")
    parts = base.split("_")
    var = parts[0]
    gcm = parts[2]
    scenario_raw = parts[3]
    rcm = parts[5]

    if scenario_raw == "evaluation":
        scenario = "evaluation"
    elif scenario_raw == "historical":
        scenario = "historical"
    elif "rcp26" in scenario_raw:
        scenario = "rcp26"
    elif "rcp85" in scenario_raw:
        scenario = "rcp85"
    else:
        scenario = scenario_raw

    model_id = f"{gcm}__{rcm}"
    return var, scenario, model_id


# ── Extract Data for All Panchayats (area-weighted) ───────────────────────────

def extract_panchayat_data(files, variable, panchayat_weights):
    """
    Extract monthly time series for each panchayat using area-weighted
    interpolation across CORDEX grid cells.

    Returns dict: {panchayat_name: [(year, month, value), ...]}
    """
    panchayat_data = defaultdict(list)

    for fpath in sorted(files):
        try:
            ds = xr.open_dataset(fpath)
            data = ds[variable].values   # shape: (time, rlat, rlon)
            times = ds["time"].values
            ds.close()

            for name, cell_weights in panchayat_weights.items():
                for t_idx, t in enumerate(times):
                    # Compute area-weighted value
                    val = 0.0
                    valid = True
                    for ri, ci, w in cell_weights:
                        v = float(data[t_idx, ri, ci])
                        if np.isnan(v):
                            valid = False
                            break
                        val += w * v

                    if not valid:
                        continue

                    t_dt = np.datetime64(t, "ns")
                    year  = int(str(t_dt)[:4])
                    month = int(str(t_dt)[5:7])

                    # Unit conversion
                    if variable == "pr":
                        days_in_month = calendar.monthrange(year, month)[1]
                        val = val * 86400 * days_in_month   # kg/m²/s → mm/month
                    elif variable in ("tas", "tasmax", "tasmin"):
                        val = val - 273.15                  # K → °C

                    panchayat_data[name].append((year, month, round(val, 2)))

        except Exception as e:
            print(f"  Warning: error processing {os.path.basename(fpath)}: {e}")

    return dict(panchayat_data)


# ── Group NetCDF Files ─────────────────────────────────────────────────────────

def group_files(data_dir):
    groups = defaultdict(list)
    nc_files = glob.glob(os.path.join(data_dir, "*.nc"))
    for fpath in nc_files:
        try:
            var, scenario, model_id = parse_filename(fpath)
            if var in VARIABLES and scenario != "evaluation":
                groups[(var, scenario, model_id)].append(fpath)
        except Exception as e:
            print(f"  Skipping {os.path.basename(fpath)}: {e}")
    return groups


# ── Ensemble Mean ──────────────────────────────────────────────────────────────

def compute_ensemble_mean(all_model_data):
    aggregated = defaultdict(lambda: defaultdict(list))
    for model_data in all_model_data:
        for panchayat, records in model_data.items():
            for year, month, val in records:
                aggregated[panchayat][(year, month)].append(val)

    result = {}
    for panchayat, ym_vals in aggregated.items():
        result[panchayat] = {
            ym: round(np.mean(vals), 2)
            for ym, vals in sorted(ym_vals.items())
        }
    return result


def build_output(ensemble_data):
    output = {}
    for panchayat, ym_vals in ensemble_data.items():
        yearly = defaultdict(dict)
        for (year, month), val in ym_vals.items():
            yearly[year][month] = val
        output[panchayat] = {str(y): m_vals for y, m_vals in sorted(yearly.items())}
    return output


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 65)
    print("CORDEX Data Preprocessing — Kozhikode Admin Units (v3)")
    print("Units: 70 GP + 7 Municipalities + 1 Corporation = 78 total")
    print("Method: Area-Weighted Grid Cell Interpolation (Shapely)")
    print("=" * 65)

    # Step 1: Load panchayat polygons
    print("\n[1/5] Loading grama panchayat polygons from GeoJSON...")
    panchayats = load_grama_panchayats(GEOJSON_PATH)
    panchayat_names = [p["name"] for p in panchayats]

    # Step 2: Build grid cell polygons from a sample NetCDF file
    print("\n[2/5] Building CORDEX grid cell polygons...")
    nc_files_all = glob.glob(os.path.join(DATA_DIR, "*.nc"))
    if not nc_files_all:
        raise FileNotFoundError(f"No .nc files found in {DATA_DIR}")

    ds0 = xr.open_dataset(nc_files_all[0])
    lat2d = ds0["lat"].values
    lon2d = ds0["lon"].values
    ds0.close()

    grid_cells = build_grid_cell_polygons(lat2d, lon2d, BBOX)
    print(f"  Built {len(grid_cells)} grid cells covering Kozhikode area")

    # Step 3: Precompute area weights (expensive but done once)
    print("\n[3/5] Computing area-weighted overlaps for each panchayat...")
    print("  (This is a one-time calculation — may take ~1-2 minutes)")
    panchayat_weights = compute_panchayat_weights(panchayats, grid_cells)
    print(f"  Done. Weights computed for {len(panchayat_weights)} panchayats")

    # Print sample weight info for a couple of panchayats
    for name in list(panchayat_weights.keys())[:3]:
        cw = panchayat_weights[name]
        cells_str = ", ".join(
            f"cell({ri},{ci})={w:.2%}" for ri, ci, w in cw
        )
        print(f"    {name}: [{cells_str}]")

    # Step 4: Process each variable + scenario
    print("\n[4/5] Extracting & interpolating climate data from NetCDF files...")
    groups = group_files(DATA_DIR)
    print(f"  Found {len(groups)} (variable, scenario, model) groups")

    all_data = defaultdict(dict)

    for var in VARIABLES:
        for scenario in ["historical", "rcp26", "rcp85"]:
            model_keys = [(v, s, m) for (v, s, m) in groups.keys()
                          if v == var and s == scenario]
            if not model_keys:
                print(f"  No data for {var}/{scenario}")
                continue

            print(f"  Processing {var}/{scenario} ({len(model_keys)} models)...")
            model_results = []
            for key in model_keys:
                data = extract_panchayat_data(groups[key], var, panchayat_weights)
                model_results.append(data)

            ensemble = compute_ensemble_mean(model_results)
            all_data[scenario][var] = build_output(ensemble)

    # Step 5: Merge historical + RCP and build final output
    print("\n[5/5] Merging historical + RCP, computing derived variables...")

    # Build centroid + type lookup for dashboard
    centroid_lookup = {p["name"]: {
        "lat": round(p["centroid_lat"], 5),
        "lon": round(p["centroid_lon"], 5),
        "type": p["local_authority_type"]
    } for p in panchayats}

    # Separate lists by type for dashboard use
    gram_panchayat_names = [p["name"] for p in panchayats if p["local_authority_type"] == "gram_panchayat"]
    urban_unit_names = [p["name"] for p in panchayats if p["local_authority_type"] in {"municipality", "municipal_corporation"}]

    final_output = {
        "panchayats": gram_panchayat_names,
        "urban_units": urban_unit_names,
        "panchayat_coords": centroid_lookup,
        "scenarios": {}
    }

    for scenario in ["rcp26", "rcp85"]:
        scenario_output = {}

        for panchayat in panchayat_names:
            panchayat_data = {
                "monthly_pr":    {},
                "monthly_tas":   {},
                "monthly_tasmax": {},
                "monthly_tasmin": {},
                "annual_pr":     {},
                "annual_tas":    {},
                "annual_dtr":    {},
                "annual_comfort": {},
                "monthly_dtr":   {},
                "baseline_pr":   0,
                "baseline_tas":  0,
            }

            for var in VARIABLES:
                hist_data   = all_data.get("historical", {}).get(var, {}).get(panchayat, {})
                future_data = all_data.get(scenario, {}).get(var, {}).get(panchayat, {})

                merged = {}
                for yr_str, months in hist_data.items():
                    if int(yr_str) <= 2005:
                        merged[yr_str] = months
                for yr_str, months in future_data.items():
                    if int(yr_str) >= 2006:
                        merged[yr_str] = months

                if var == "pr":
                    panchayat_data["monthly_pr"] = merged
                elif var == "tas":
                    panchayat_data["monthly_tas"] = merged
                elif var == "tasmax":
                    panchayat_data["monthly_tasmax"] = merged
                elif var == "tasmin":
                    panchayat_data["monthly_tasmin"] = merged

            years_with_data = sorted(set(
                list(panchayat_data["monthly_pr"].keys()) +
                list(panchayat_data["monthly_tas"].keys())
            ))

            baseline_pr_vals  = []
            baseline_tas_vals = []

            for yr_str in years_with_data:
                yr = int(yr_str)

                pr_months = panchayat_data["monthly_pr"].get(yr_str, {})
                if pr_months:
                    annual_pr = sum(pr_months.values())
                    panchayat_data["annual_pr"][yr_str] = round(annual_pr, 1)
                    if 1981 <= yr <= 2005:
                        baseline_pr_vals.append(annual_pr)

                tas_months = panchayat_data["monthly_tas"].get(yr_str, {})
                if tas_months:
                    annual_tas = np.mean(list(tas_months.values()))
                    panchayat_data["annual_tas"][yr_str] = round(float(annual_tas), 2)
                    if 1981 <= yr <= 2005:
                        baseline_tas_vals.append(float(annual_tas))

                tmax_months = panchayat_data["monthly_tasmax"].get(yr_str, {})
                tmin_months = panchayat_data["monthly_tasmin"].get(yr_str, {})
                if tmax_months and tmin_months:
                    dtr_vals   = []
                    monthly_dtr = {}
                    for m_str in tmax_months:
                        if m_str in tmin_months:
                            dtr = tmax_months[m_str] - tmin_months[m_str]
                            dtr_vals.append(dtr)
                            monthly_dtr[m_str] = round(dtr, 2)
                    if dtr_vals:
                        panchayat_data["annual_dtr"][yr_str] = round(float(np.mean(dtr_vals)), 2)
                    panchayat_data["monthly_dtr"][yr_str] = monthly_dtr

                if tas_months:
                    comfort_vals = []
                    for m_str, t_val in tas_months.items():
                        di = t_val - (0.55 - 0.0055 * RH_KOZHIKODE) * (t_val - 14.5)
                        comfort_vals.append(di)
                    panchayat_data["annual_comfort"][yr_str] = round(float(np.mean(comfort_vals)), 2)

            if baseline_pr_vals:
                panchayat_data["baseline_pr"] = round(float(np.mean(baseline_pr_vals)), 1)
            if baseline_tas_vals:
                panchayat_data["baseline_tas"] = round(float(np.mean(baseline_tas_vals)), 2)

            # Remove large intermediate fields
            del panchayat_data["monthly_tasmax"]
            del panchayat_data["monthly_tasmin"]

            scenario_output[panchayat] = panchayat_data

        final_output["scenarios"][scenario] = scenario_output

    # Save
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    output_path = os.path.join(OUTPUT_DIR, "kozhikode_climate_data.json")
    with open(output_path, "w") as f:
        json.dump(final_output, f)
    file_size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"  Saved: {output_path} ({file_size_mb:.1f} MB)")

    print("\n" + "=" * 65)
    print("SUMMARY")
    print("=" * 65)
    print(f"  Total admin units processed: {len(panchayat_names)}")
    print(f"    Grama Panchayats : {len(gram_panchayat_names)}")
    print(f"    Urban units      : {len(urban_unit_names)}")
    for scenario in ["rcp26", "rcp85"]:
        p0 = panchayat_names[0]
        if p0 in final_output["scenarios"][scenario]:
            p_data = final_output["seasons"][scenario][p0] if False else final_output["scenarios"][scenario][p0]
            years = sorted(p_data["annual_pr"].keys())
            if years:
                print(f"  {scenario}: {len(years)} years ({years[0]}–{years[-1]})")
                print(f"    Baseline Precip ({p0}): {p_data['baseline_pr']:.1f} mm/yr")
                print(f"    Baseline Temp   ({p0}): {p_data['baseline_tas']:.2f} °C")

    print("\nDone! Now open dashboard/index.html to view the dashboard.")


if __name__ == "__main__":
    main()
