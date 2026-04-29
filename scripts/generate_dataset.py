"""
generate_dataset.py
===================
Generates the enriched traffic dataset CSV from clean GeoJSON source files.

Data sources (expected in <project_root>/data/clean/):
  - Logradouros_CLEAN.geojson  — street network with speed limits and neighbourhoods
  - Rotas_Regulares_CLEAN.geojson — bus route geometries with service IDs
  - Pontos_Paradas_CLEAN.geojson  — bus stop locations

Output:
  <project_root>/data/processed/rio_traffic_final_enriched.csv
"""

import json
import csv
import random
from datetime import datetime, timedelta
import os
import re
from pathlib import Path
from collections import defaultdict

# ─── Paths (relative to project root — no hardcoded absolute paths) ───────────
SCRIPT_DIR   = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent

PATH_CLEAN     = PROJECT_ROOT / "data" / "clean"
PATH_PROCESSED = PROJECT_ROOT / "data" / "processed"

FILE_STREETS = PATH_CLEAN / "Logradouros_CLEAN.geojson"
FILE_ROUTES  = PATH_CLEAN / "Rotas_Regulares_CLEAN.geojson"
FILE_STOPS   = PATH_CLEAN / "Pontos_Paradas_CLEAN.geojson"

OUTPUT_FILE = PATH_PROCESSED / "rio_traffic_final_enriched.csv"


# ─── Helpers ──────────────────────────────────────────────────────────────────

def load_geojson(filepath):
    """Loads a GeoJSON file and returns its features list."""
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return []
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data.get('features', [])
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
        return []


def get_centroid(coords):
    """Returns (lat, lon) centroid for Point, LineString, or MultiLineString coordinates."""
    if not coords:
        return None, None
    # Point
    if isinstance(coords[0], (int, float)):
        return coords[1], coords[0]
    # LineString
    if isinstance(coords[0], list) and isinstance(coords[0][0], (int, float)):
        lats = [c[1] for c in coords]
        lons = [c[0] for c in coords]
        return sum(lats) / len(lats), sum(lons) / len(lons)
    # MultiLineString
    if isinstance(coords[0], list) and isinstance(coords[0][0], list):
        all_lats, all_lons = [], []
        for line in coords:
            for pt in line:
                all_lats.append(pt[1])
                all_lons.append(pt[0])
        if not all_lats:
            return None, None
        return sum(all_lats) / len(all_lats), sum(all_lons) / len(all_lons)
    return None, None


def normalize_category(text):
    """
    Converts categorical text to lowercase snake_case.
    Examples: 'STREET' -> 'street', 'Barra da Tijuca' -> 'barra_da_tijuca'
    """
    if not text:
        return ""
    text = str(text).lower().strip()
    text = text.replace(' ', '_').replace('-', '_')
    text = re.sub(r'[^a-z0-9_]', '', text)
    return text


def get_stop_name(props):
    """Extracts stop name from properties, trying multiple possible field names."""
    for key in ['stop_name', 'nome', 'Nome', 'descricao', 'Descricao', 'nome_parada']:
        val = props.get(key)
        if val and isinstance(val, str) and val.strip():
            return val.strip()
    return 'Unknown Stop'


def build_route_map(route_features):
    """
    Builds a spatial grid map (lat/lon rounded to 2 decimals) →
    list of {service_id, consortium} for all routes covering that cell.
    Also returns the full list of valid lines for fallback assignment.
    """
    print("Building route coverage map...")
    route_coverage  = defaultdict(list)
    seen_combos     = set()
    all_valid_lines = []

    for feat in route_features:
        props = feat.get('properties', {})
        geom  = feat.get('geometry', {})

        service_id = props.get('servico') or props.get('service_id') or props.get('Servico')
        consortium = props.get('consortium') or props.get('consorcio') or props.get('Consortium')

        if not service_id:
            continue

        s_id   = str(service_id).strip()
        c_name = str(consortium).strip() if consortium else 'unknown'
        line_info = {'service_id': s_id, 'consortium': c_name}
        all_valid_lines.append(line_info)

        lat, lon = get_centroid(geom.get('coordinates', []))
        if lat is None:
            continue

        lat_grid = round(lat, 2)
        lon_grid = round(lon, 2)
        combo    = f"{lat_grid}_{lon_grid}_{s_id}"

        if combo not in seen_combos:
            route_coverage[(lat_grid, lon_grid)].append(line_info)
            seen_combos.add(combo)

    print(f"  Route map built: {len(seen_combos)} unique route-cell combinations")
    return route_coverage, all_valid_lines


def guess_neighbourhood(stop_name, road_map):
    """Tries to infer neighbourhood from stop name by matching against street names."""
    if stop_name == 'Unknown Stop':
        return None
    stop_upper = stop_name.upper()
    for road_name, info in road_map.items():
        if stop_upper in road_name or road_name in stop_upper:
            return info['bairro']
    return None


# ─── Main processing ──────────────────────────────────────────────────────────

def process_datasets():
    print("Generating enriched traffic dataset...")
    print(f"Source directory: {PATH_CLEAN}")

    # 1. Load street network
    print("\nLoading street network (Logradouros)...")
    street_features = load_geojson(FILE_STREETS)
    road_map = {}

    for feat in street_features:
        props = feat.get('properties', {})
        geom  = feat.get('geometry', {})

        name = props.get('completo', '').strip()
        if not name:
            tipo    = props.get('tipo_logra_ext', '')
            parcial = props.get('nome_parcial', '')
            name    = f"{tipo} {parcial}".strip()

        if not name:
            continue

        key      = name.upper()
        lat, lon = get_centroid(geom.get('coordinates', []))

        if key not in road_map and lat is not None:
            road_map[key] = {
                'bairro':      props.get('bairro', 'Unknown'),
                'tipo':        props.get('tipo_logra_ext', 'STREET'),
                'speed_limit': props.get('velocidade_regulamentada', 40),
                'lat': lat,
                'lon': lon
            }

    print(f"  {len(road_map)} streets indexed")

    # 2. Load routes and build spatial coverage map
    print("\nLoading bus routes...")
    route_features = load_geojson(FILE_ROUTES)
    route_coverage_map, all_valid_lines = build_route_map(route_features)

    if not all_valid_lines:
        print("CRITICAL ERROR: No valid bus lines found — aborting.")
        return

    # 3. Generate records based on bus stops
    print("\nGenerating enriched records from bus stops...")
    stop_features  = load_geojson(FILE_STOPS)
    records        = []
    start_date     = datetime(2026, 1, 1)
    total_stops    = len(stop_features)
    unknown_count  = 0

    # Hour-of-day weight distribution (0–23h) — peaks at morning and evening rush
    HOUR_WEIGHTS = [1,1,1,1,2,3,7,9,9,6,4,4,4,4,5,8,10,10,7,5,3,2,1,1]

    for i, feat in enumerate(stop_features):
        if i % 2000 == 0:
            print(f"  Processing stops: {i}/{total_stops}...")

        props = feat.get('properties', {})
        geom  = feat.get('geometry', {})
        coords = geom.get('coordinates', [])
        if not coords:
            continue

        lon, lat = coords[0], coords[1]
        stop_name = get_stop_name(props)
        if stop_name == 'Unknown Stop':
            unknown_count += 1

        # Find lines covering this stop's grid cell
        lat_grid = round(lat, 2)
        lon_grid = round(lon, 2)
        available_lines = route_coverage_map.get((lat_grid, lon_grid), [])
        if not available_lines:
            available_lines = random.sample(all_valid_lines, min(3, len(all_valid_lines)))
        if not available_lines:
            continue

        # Infer neighbourhood
        neighbourhood = guess_neighbourhood(stop_name, road_map)
        raw_region    = neighbourhood if neighbourhood else random.choice(
            ["zona_sul", "centro", "barra_da_tijuca", "tijuca", "zona_norte"]
        )
        region = normalize_category(raw_region)

        # Road type and speed limit based on region
        raw_road_type = "STREET"
        speed_limit   = 50
        if "barra" in region or "recreio" in region:
            raw_road_type = "AVENUE"
            speed_limit   = 70
        elif "centro" in region:
            raw_road_type = "AVENUE"
            speed_limit   = 40
        road_type = normalize_category(raw_road_type)

        # Zone congestion multiplier
        zone_intensity = 1.0
        if region == "centro":     zone_intensity = 1.5
        elif region == "zona_sul": zone_intensity = 1.3
        elif region == "zona_norte": zone_intensity = 0.9

        # Generate multiple samples per stop across different times and conditions
        samples_per_stop = random.randint(4, 8)

        for _ in range(samples_per_stop):
            raw_day    = random.choice(["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"])
            day_of_week = normalize_category(raw_day)
            is_weekend  = day_of_week in ["saturday", "sunday"]

            hour    = random.choices(range(24), weights=HOUR_WEIGHTS)[0]
            is_peak = (7 <= hour <= 9) or (17 <= hour <= 19)
            is_night = (0 <= hour <= 5)

            selected_line = random.choice(available_lines)
            service_id    = selected_line['service_id']
            consortium    = normalize_category(selected_line['consortium'])

            # Bus line count varies by time and zone
            base_lines = int(random.randint(5, 15) * zone_intensity)
            if is_weekend: base_lines = int(base_lines * 0.6)
            if is_night:   base_lines = max(1, int(base_lines * 0.1))
            bus_line_count = max(1, base_lines + random.randint(-2, 3))

            # Vehicle volume and speed vary by time
            base_volume = int(random.randint(200, 600) * zone_intensity)
            if is_night:
                vehicle_volume = int(base_volume * 0.05)
                avg_speed      = round(random.uniform(speed_limit * 0.95, speed_limit * 1.3), 2)
            elif is_peak:
                vehicle_volume = int(base_volume * 1.8)
                avg_speed      = round(random.uniform(15.0, 35.0), 2)
            elif is_weekend:
                vehicle_volume = int(base_volume * 0.7)
                avg_speed      = round(random.uniform(40.0, speed_limit * 1.1), 2)
            else:
                vehicle_volume = base_volume
                avg_speed      = round(random.uniform(40.0, speed_limit * 1.1), 2)

            # Weather affects speed and volume
            raw_weather = random.choices(["CLEAR","CLOUDY","RAIN"], weights=[50, 30, 20])[0]
            weather     = normalize_category(raw_weather)
            if weather == "rain":
                avg_speed      = round(avg_speed * 0.85, 2)
                if not is_night:
                    vehicle_volume = int(vehicle_volume * 1.1)

            # Derive traffic level from speed and volume
            if avg_speed < 20 or vehicle_volume > 900:
                traffic_level = "congested"
            elif avg_speed < 40 or vehicle_volume > 600:
                traffic_level = "high"
            elif avg_speed < 55:
                traffic_level = "medium"
            else:
                traffic_level = "low"

            timestamp = start_date + timedelta(
                days=random.randint(0, 60),
                hours=hour,
                minutes=random.randint(0, 59)
            )

            records.append({
                "road_name":      f"Near {stop_name}",
                "road_type":      road_type,
                "region":         region,
                "day_of_week":    day_of_week,
                "hour":           hour,
                "service_id":     service_id,
                "consortium":     consortium,
                "bus_line_count": bus_line_count,
                "vehicle_volume": vehicle_volume,
                "avg_speed":      avg_speed,
                "speed_limit":    speed_limit,
                "traffic_level":  traffic_level,
                "event_nearby":   random.random() < 0.05,
                "weather":        weather,
                "timestamp":      timestamp.strftime("%Y-%m-%d %H:%M:%S"),
                "latitude":       round(lat, 6),
                "longitude":      round(lon, 6)
            })

    # 4. Write CSV
    os.makedirs(PATH_PROCESSED, exist_ok=True)

    fieldnames = [
        "road_name", "road_type", "region", "day_of_week", "hour",
        "service_id", "consortium",
        "bus_line_count", "vehicle_volume", "avg_speed", "speed_limit",
        "traffic_level", "event_nearby", "weather", "timestamp",
        "latitude", "longitude"
    ]

    with open(OUTPUT_FILE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)

    # 5. Summary
    print(f"\nDone.")
    print(f"  Output file    : {OUTPUT_FILE}")
    print(f"  Total records  : {len(records)}")

    unique_lines       = set(r['service_id']    for r in records)
    unique_consortiums = set(r['consortium']     for r in records)
    unique_regions     = set(r['region']         for r in records)
    unique_levels      = set(r['traffic_level']  for r in records)

    print(f"  Unique lines       : {len(unique_lines)}")
    print(f"  Unique consortiums : {unique_consortiums}")
    print(f"  Unique regions     : {len(unique_regions)}")
    print(f"  Traffic levels     : {unique_levels}")

    if records:
        pct_unknown = unknown_count / len(records) * 100
        print(f"  Unknown stop names : {unknown_count} ({pct_unknown:.2f}%)")


if __name__ == "__main__":
    process_datasets()
