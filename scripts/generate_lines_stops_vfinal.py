"""
generate_lines_stops.py
=======================
Generates lines + stops JSON with direction-aware right-side filtering.

Key improvement over the previous version:
  - Uses a directional (asymmetric) buffer instead of a symmetric one.
  - For each stop candidate, computes the cross product between the path
    direction vector at the closest point and the vector from that point
    to the stop.
  - In Brazil (right-hand traffic), valid boarding stops must be on the
    RIGHT side of the travel direction (cross product <= 0).
  - Stops on the left side are discarded from the dataset.
"""

import geopandas as gpd
import pandas as pd
import numpy as np
import json
from pathlib import Path
from shapely.geometry import Point

# ─── Paths ────────────────────────────────────────────────────────────────────
import argparse, os

SCRIPT_DIR   = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
DATA_DIR     = PROJECT_ROOT / "backend" / "traffic-insight" / "src" / "main" / "resources" / "data"

parser = argparse.ArgumentParser(description="Generate lines + stops JSON with right-side filter")
parser.add_argument("--routes", default=os.getenv("ROUTES_PATH",  str(SCRIPT_DIR / "Rotas_Regulares_CLEAN.geojson")),
                    help="Path to routes GeoJSON (default: ./Rotas_Regulares_CLEAN.geojson)")
parser.add_argument("--stops",  default=os.getenv("STOPS_PATH",   str(SCRIPT_DIR / "Pontos_Paradas_CLEAN.geojson")),
                    help="Path to stops GeoJSON  (default: ./Pontos_Paradas_CLEAN.geojson)")
parser.add_argument("--output", default=os.getenv("OUTPUT_PATH",  str(DATA_DIR   / "lines_with_stops_vfinal.json")),
                    help="Path to output JSON    (default: <project>/backend/.../data/lines_with_stops_vfinal.json)")
args = parser.parse_args()

routes_path = Path(args.routes)
stops_path  = Path(args.stops)
output_path = Path(args.output)

# ─── Config ───────────────────────────────────────────────────────────────────
BUFFER_METERS     = 15   # search radius around route (meters, EPSG:3857)
CROSS_TOLERANCE   = 2.0  # meters — stops within this lateral distance from the
                          # centre line are kept regardless of side (avoids
                          # discarding stops exactly on the kerb line)

print("Starting lines + stops generation (right-side filter)...")
print(f"Output: {output_path}")

# ─── 1. Load data ─────────────────────────────────────────────────────────────
print("\nLoading data...")
routes = gpd.read_file(routes_path)
stops  = gpd.read_file(stops_path)
print(f"  {len(routes)} routes loaded")
print(f"  {len(stops)} stops loaded")

# ─── 2. Project to metric CRS ─────────────────────────────────────────────────
print("\nProjecting to EPSG:3857 (metres)...")
routes = routes.to_crs(epsg=3857)
stops  = stops.to_crs(epsg=3857)

# ─── 3. Symmetric buffer for candidate selection ──────────────────────────────
# We still use a symmetric buffer to collect candidates, then filter by side.
print(f"\nBuilding {BUFFER_METERS}m symmetric buffer for candidate selection...")
routes_buffered          = routes.copy()
routes_buffered["geom_orig"] = routes_buffered.geometry  # keep original line
routes_buffered["geometry"]  = routes_buffered.geometry.buffer(BUFFER_METERS)

# ─── 4. Spatial join ─────────────────────────────────────────────────────────
print("\nSpatial join (stops within buffer)...")
joined = gpd.sjoin(stops, routes_buffered, predicate="within")
print(f"  {len(joined)} candidate stop-route pairs found")

# Normalise direction column
if "direcao" not in joined.columns:
    joined["direcao"] = 0
else:
    joined["direcao"] = joined["direcao"].fillna(0).astype(int)

# ─── 5. Right-side filter (cross product) ────────────────────────────────────

def is_on_right_side(stop_x: float, stop_y: float, line_geom) -> bool:
    """
    Returns True if the stop is on the RIGHT side of the line's travel direction,
    or within CROSS_TOLERANCE metres of the centre line.

    Method:
      1. Find the closest point on the line to the stop.
      2. Get the next point along the line to form a direction vector.
      3. Compute the 2D cross product of (direction, stop_offset).
         cross < 0  → stop is on the RIGHT  ✓ (valid in Brazil)
         cross > 0  → stop is on the LEFT   ✗ (discard)
         |cross| small → stop is nearly on the line → keep (tolerance)
    """
    coords = list(line_geom.coords)
    if len(coords) < 2:
        return True  # can't determine — keep by default

    stop_pt = np.array([stop_x, stop_y])

    # Find closest segment index
    min_dist  = float('inf')
    closest_i = 0
    for i in range(len(coords) - 1):
        p1 = np.array(coords[i])
        p2 = np.array(coords[i + 1])
        seg = p2 - p1
        seg_len_sq = np.dot(seg, seg)
        if seg_len_sq == 0:
            continue
        t = max(0, min(1, np.dot(stop_pt - p1, seg) / seg_len_sq))
        proj  = p1 + t * seg
        dist  = np.linalg.norm(stop_pt - proj)
        if dist < min_dist:
            min_dist  = dist
            closest_i = i

    # Tolerance check — stops very close to the centre line are kept
    if min_dist < CROSS_TOLERANCE:
        return True

    # Direction vector of the closest segment
    p1  = np.array(coords[closest_i])
    p2  = np.array(coords[min(closest_i + 1, len(coords) - 1)])
    direction = p2 - p1

    # Vector from closest point on line to stop
    proj_pt     = p1 + max(0, min(1, np.dot(stop_pt - p1, direction) /
                                     max(np.dot(direction, direction), 1e-10))) * direction
    stop_offset = stop_pt - proj_pt

    # 2D cross product: direction × stop_offset
    # Negative → stop is to the RIGHT of the travel direction ✓
    cross = direction[0] * stop_offset[1] - direction[1] * stop_offset[0]

    return cross <= 0  # right side or on the line

print("\nApplying right-side filter (Brazil — right-hand traffic)...")

keep_mask = []
for _, row in joined.iterrows():
    line_geom = row["geom_orig"]
    stop_x    = row.geometry.x
    stop_y    = row.geometry.y
    keep_mask.append(is_on_right_side(stop_x, stop_y, line_geom))

joined_filtered = joined[keep_mask].copy()
removed = len(joined) - len(joined_filtered)
print(f"  Kept  : {len(joined_filtered)} stops")
print(f"  Removed (left side): {removed} stops ({removed/max(len(joined),1)*100:.1f}%)")

# ─── 5b. For stops associated with multiple routes, keep only the closest ──────
# This prevents cross-line contamination where a stop near a BRS corridor
# gets assigned to multiple unrelated lines.
print("\nRemoving cross-line contamination (keeping closest route per stop)...")

# Calculate distance from each stop to its matched route (original line geometry)
joined_filtered["dist_to_route"] = joined_filtered.apply(
    lambda row: row.geometry.distance(row["geom_orig"]), axis=1
)

# For each stop_id, keep only the (line_id, direcao) pair with minimum distance
before_decontam = len(joined_filtered)
# At this stage the route identifier is still called 'servico' (renamed to
# 'line_id' in step 6). Use 'servico' here.
joined_filtered = (
    joined_filtered
    .sort_values("dist_to_route")
    .drop_duplicates(subset=["stop_id", "servico"], keep="first")
    .reset_index(drop=True)
)
after_decontam = len(joined_filtered)
print(f"  Removed {before_decontam - after_decontam} cross-line duplicates")
print(f"  Remaining: {after_decontam}")

# ─── 6. Select relevant columns ──────────────────────────────────────────────
cols = [c for c in ["stop_id", "stop_name", "servico", "direcao", "geometry"] if c in joined_filtered.columns]
joined_filtered = joined_filtered[cols].rename(columns={"servico": "line_id"})

# ─── 7. Deduplicate nearby stops (<5 m) per line + direction ─────────────────
print("\nDeduplicating nearby stops (< 5 m)...")

def deduplicate_nearby_stops(group, threshold=5.0):
    if len(group) <= 1:
        return group
    coords      = np.array([(g.x, g.y) for g in group.geometry])
    kept_indices = [0]
    for i in range(1, len(coords)):
        too_close = any(
            np.linalg.norm(coords[i] - coords[k]) < threshold
            for k in kept_indices
        )
        if not too_close:
            kept_indices.append(i)
    return group.iloc[kept_indices]

deduplicated = joined_filtered.groupby(
    ["line_id", "direcao"], group_keys=False
).apply(deduplicate_nearby_stops, threshold=5.0)

print(f"  Before: {len(joined_filtered)} | After: {len(deduplicated)} "
      f"(removed {len(joined_filtered) - len(deduplicated)}) — threshold 25m")

# ─── 8. Add WGS-84 coordinates ───────────────────────────────────────────────
print("\nAdding WGS-84 coordinates...")
stops_wgs84      = stops.to_crs(epsg=4326)
stops_wgs84["lng"] = stops_wgs84.geometry.x
stops_wgs84["lat"] = stops_wgs84.geometry.y
stops_df           = stops_wgs84[["stop_id", "stop_name", "lat", "lng"]]

result_cols = [c for c in ["stop_id", "stop_name", "line_id", "direcao"]
               if c in deduplicated.columns]
enriched = deduplicated[result_cols].merge(stops_df, on=["stop_id", "stop_name"], how="left")

# ─── 9. Sort stops along path and group by line / direction ──────────────────

def path_index(stop_lat, stop_lon, path_coords):
    """Returns the index of the closest path point to the stop."""
    min_dist  = float('inf')
    closest_i = 0
    for i, (p_lon, p_lat) in enumerate(path_coords):
        d = (stop_lat - p_lat) ** 2 + (stop_lon - p_lon) ** 2
        if d < min_dist:
            min_dist  = d
            closest_i = i
    return closest_i

# Reload route geometries in WGS-84 for path extraction
routes_wgs84 = gpd.read_file(routes_path)
if "direcao" in routes_wgs84.columns:
    routes_wgs84["direcao"] = routes_wgs84["direcao"].fillna(0).astype(int)
else:
    routes_wgs84["direcao"] = 0
routes_wgs84["servico"] = routes_wgs84["servico"].astype(str).str.strip()

def extract_path(geom):
    if geom is None:
        return []
    if geom.geom_type == "LineString":
        return [[x, y] for x, y in geom.coords]
    if geom.geom_type == "MultiLineString":
        return [[x, y] for line in geom.geoms for x, y in line.coords]
    return []

print("\nGrouping by line and direction, sorting stops along path...")
grouped        = enriched.groupby("line_id")
result         = []
circular_count = 0
two_way_count  = 0

for line_id, group in grouped:
    directions     = {}
    unique_dirs    = group["direcao"].unique() if "direcao" in group.columns else [0]

    for direction in unique_dirs:
        dir_group  = group[group["direcao"] == direction]
        stops_list = (
            dir_group[["stop_id", "stop_name", "lat", "lng", "direcao"]]
            .drop_duplicates()
            .to_dict("records")
        )

        # Normalise direction key
        for s in stops_list:
            s["direction"] = int(s.pop("direcao", direction))

        # Get matching route geometry for sorting
        route_match = routes_wgs84[
            (routes_wgs84["servico"].str.endswith(str(line_id))) &
            (routes_wgs84["direcao"] == int(direction))
        ]
        if route_match.empty:
            route_match = routes_wgs84[routes_wgs84["servico"].str.endswith(str(line_id))]

        path_coords = extract_path(route_match.iloc[0].geometry) if not route_match.empty else []

        if path_coords:
            stops_list = sorted(
                stops_list,
                key=lambda s: path_index(s["lat"], s["lng"], path_coords)
            )

        directions[str(int(direction))] = {
            "stops":     stops_list,
            "stopCount": len(stops_list)
        }

    is_circular = len(directions) == 1
    circular_count += is_circular
    two_way_count  += not is_circular

    result.append({
        "lineId":         line_id,
        "directions":     directions,
        "totalStops":     len(group),
        "directionCount": len(directions),
        "routeType":      "circular" if is_circular else "two-way"
    })

# ─── 10. Save ─────────────────────────────────────────────────────────────────
output_path.parent.mkdir(parents=True, exist_ok=True)
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(result, f, indent=2, ensure_ascii=False)

print(f"\nDone.")
print(f"  Total lines       : {len(result)}")
print(f"  Circular (1-dir)  : {circular_count}")
print(f"  Two-way (2-dir)   : {two_way_count}")
print(f"  Output            : {output_path}")

# ─── 11. Validation sample ────────────────────────────────────────────────────
if result:
    s = result[0]
    print(f"\nSample — line {s['lineId']} ({s['routeType']}):")
    for dk, dd in s["directions"].items():
        print(f"  Direction {dk}: {dd['stopCount']} stops")
        if dd["stops"]:
            print(f"    First: {dd['stops'][0].get('stop_name')}")
            print(f"    Last : {dd['stops'][-1].get('stop_name')}")
