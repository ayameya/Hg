#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
export WORK="${WORK:-/home/user/data}"
PY="${PY:-python3}"
PLANET_URL="${PLANET_URL:-https://osm-pds.s3.amazonaws.com/planet-latest.osm.pbf}"
mkdir -p "$WORK/layers" "$ROOT/docs/data"

if [ ! -s "$WORK/tokyo.osm.pbf" ]; then
  curl -sS --retry 5 "$PLANET_URL" | osmium extract -F pbf -s simple -b 139.45,35.40,140.05,35.95 - -o "$WORK/tokyo.osm.pbf" --overwrite
fi

cd "$HERE"
"$PY" wards.py
"$PY" layers.py
"$PY" ksj.py
"$PY" facilities.py
"$PY" blocks.py
if [ "${SKIP_EKITAN:-0}" != "1" ]; then "$PY" ekitan.py; fi
"$PY" underground.py
node "$ROOT/web/tools/compile-hours.mjs" "$ROOT/docs/data/network.json"
"$PY" lite.py
"$PY" search_index.py

cd "$ROOT/web"
npm run build
