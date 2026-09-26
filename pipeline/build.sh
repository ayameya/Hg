#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
WORK="${WORK:-/home/user/data}"
PY="${PY:-python3}"
PLANET_URL="${PLANET_URL:-https://osm-pds.s3.amazonaws.com/planet-latest.osm.pbf}"
FONTS_DIR="${FONTS_DIR:-}"
mkdir -p "$WORK/layers" "$ROOT/docs/data"

if [ ! -s "$WORK/tokyo.osm.pbf" ]; then
  curl -sS --retry 5 "$PLANET_URL" | osmium extract -F pbf -s simple -b 139.45,35.40,140.05,35.95 - -o "$WORK/tokyo.osm.pbf" --overwrite
fi

cd "$HERE"
"$PY" wards.py
"$PY" layers.py
"$PY" underground.py

tippecanoe -o "$ROOT/docs/data/base.pmtiles" --force -Z8 -z15 --clip-bounding-box=139.54,35.50,139.94,35.83 \
  --no-tile-stats --drop-densest-as-needed --simplification=4 --detect-shared-borders \
  -L "{\"file\":\"$WORK/layers/water.geojsonseq\",\"layer\":\"water\"}" \
  -L "{\"file\":\"$WORK/layers/waterway.geojsonseq\",\"layer\":\"waterway\"}" \
  -L "{\"file\":\"$WORK/layers/green.geojsonseq\",\"layer\":\"green\"}" \
  -L "{\"file\":\"$WORK/layers/building.geojsonseq\",\"layer\":\"building\"}" \
  -L "{\"file\":\"$WORK/layers/road.geojsonseq\",\"layer\":\"road\"}" \
  -L "{\"file\":\"$WORK/layers/rail.geojsonseq\",\"layer\":\"rail\"}" \
  -L "{\"file\":\"$WORK/layers/station.geojsonseq\",\"layer\":\"station\"}" \
  -L "{\"file\":\"$WORK/layers/bus_route.geojsonseq\",\"layer\":\"bus_route\"}" \
  -L "{\"file\":\"$WORK/layers/bus_stop.geojsonseq\",\"layer\":\"bus_stop\"}" \
  -L "{\"file\":\"$WORK/layers/ferry.geojsonseq\",\"layer\":\"ferry\"}" \
  -L "{\"file\":\"$WORK/layers/facility.geojsonseq\",\"layer\":\"facility\"}" \
  -L "{\"file\":\"$WORK/layers/place.geojsonseq\",\"layer\":\"place\"}" \
  -L "{\"file\":\"$WORK/layers/ward.geojsonseq\",\"layer\":\"ward\"}" \
  -L "{\"file\":\"$WORK/layers/ward_label.geojsonseq\",\"layer\":\"ward_label\"}"

if [ -n "$FONTS_DIR" ]; then
  mkdir -p "$ROOT/docs/fonts"
  for f in "Noto Sans Regular" "Noto Sans Medium"; do
    rm -rf "$ROOT/docs/fonts/$f"
    cp -r "$FONTS_DIR/$f" "$ROOT/docs/fonts/$f"
  done
  cp "$FONTS_DIR/OFL.txt" "$ROOT/docs/fonts/OFL.txt"
fi

cd "$ROOT/web"
npm run build
