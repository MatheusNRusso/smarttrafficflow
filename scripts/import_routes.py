"""
import_routes.py
===============
Imports bus route geometries from Rotas_Regulares_CLEAN.geojson
into the PostgreSQL routes table.

Run once after applying the V5 Flyway migration:
  python import_routes.py \
    --geojson /path/to/Rotas_Regulares_CLEAN.geojson \
    --db-url  postgresql://user:password@host:port/dbname

Environment variables (alternative to CLI args):
  ROUTES_GEOJSON_PATH
  DATABASE_URL  (format: postgresql://user:password@host:port/dbname)
"""

import json
import argparse
import os
import sys
from pathlib import Path

try:
    import psycopg2
    from psycopg2.extras import execute_batch
except ImportError:
    print("psycopg2 not found. Install with: pip install psycopg2-binary")
    sys.exit(1)

SCRIPT_DIR = Path(__file__).resolve().parent

parser = argparse.ArgumentParser(description="Import routes GeoJSON into PostgreSQL")
parser.add_argument("--geojson",  default=os.getenv("ROUTES_GEOJSON_PATH",
                    str(SCRIPT_DIR / "Rotas_Regulares_CLEAN.geojson")),
                    help="Path to Rotas_Regulares_CLEAN.geojson")
parser.add_argument("--db-url",   default=os.getenv("DATABASE_URL", ""),
                    help="PostgreSQL connection URL")
parser.add_argument("--db-host",  default=os.getenv("DB_HOST",     ""))
parser.add_argument("--db-port",  default=os.getenv("DB_PORT",     ""))
parser.add_argument("--db-name",  default=os.getenv("DB_NAME",     ""))
parser.add_argument("--db-user",  default=os.getenv("DB_USERNAME", ""))
parser.add_argument("--db-pass",  default=os.getenv("DB_PASSWORD", ""))
parser.add_argument("--batch",    type=int, default=100)
parser.add_argument("--truncate", action="store_true")
args = parser.parse_args()

def get_connection():
    if args.db_url:
        return psycopg2.connect(args.db_url)
    if not all([args.db_host, args.db_port, args.db_name, args.db_user]):
        print("Error: provide --db-url or all of --db-host, --db-port, --db-name, --db-user")
        sys.exit(1)
    return psycopg2.connect(
        host=args.db_host, port=args.db_port,
        dbname=args.db_name, user=args.db_user, password=args.db_pass
    )

def main():
    geojson_path = Path(args.geojson)
    if not geojson_path.exists():
        print(f"GeoJSON not found: {geojson_path}")
        sys.exit(1)

    print(f"Loading {geojson_path.name}...")
    with open(geojson_path, encoding='utf-8') as f:
        data = json.load(f)

    features = data.get('features', [])
    print(f"  {len(features)} route features found")

    conn   = get_connection()
    cursor = conn.cursor()

    if args.truncate:
        cursor.execute("TRUNCATE TABLE routes RESTART IDENTITY;")
        print("  Table truncated")

    cursor.execute("SELECT COUNT(*) FROM routes;")
    existing = cursor.fetchone()[0]
    if existing > 0 and not args.truncate:
        print(f"  Table already has {existing} rows. Use --truncate to re-import.")
        conn.close()
        return

    rows    = []
    skipped = 0

    for feat in features:
        props = feat.get('properties', {})
        geom  = feat.get('geometry',   {})

        servico = props.get('servico') or ''
        if not servico:
            skipped += 1
            continue

        coords = geom.get('coordinates', [])
        if not coords:
            skipped += 1
            continue

        rows.append((
            str(servico).strip(),
            int(props.get('direcao', 0) or 0),
            props.get('destino',   ''),
            props.get('consorcio', '') or props.get('consortium', ''),
            props.get('tipo_rota', ''),
            props.get('extensao',  None),
            props.get('shape_id',  ''),
            json.dumps(coords, separators=(',', ':'))
        ))

    print(f"  {len(rows)} rows to insert ({skipped} skipped)")

    execute_batch(cursor, """
        INSERT INTO routes (servico, direcao, destino, consorcio, tipo_rota, extensao, shape_id, geometry)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    """, rows, page_size=args.batch)

    conn.commit()
    cursor.execute("SELECT COUNT(*) FROM routes;")
    print(f"\nDone. {cursor.fetchone()[0]} routes imported.")
    conn.close()

if __name__ == "__main__":
    main()
