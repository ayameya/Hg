#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
target="${1:-esp32c3}"
source_mode="${2:-analog}"
shift $(( $# > 2 ? 2 : $# )) || true

case "$target" in
  esp32c3) fqbn="esp32:esp32:XIAO_ESP32C3" ;;
  pico2w) fqbn="rp2040:rp2040:rpipico2w" ;;
  *) echo "usage: $0 [esp32c3|pico2w] [analog|pulse|simulated] [extra arduino-cli args]" >&2; exit 2 ;;
esac

case "$source_mode" in
  analog) source_id=0 ;;
  pulse) source_id=1 ;;
  simulated) source_id=2 ;;
  *) echo "unknown source: $source_mode" >&2; exit 2 ;;
esac

build="${TUBEPI_BUILD_DIR:-$root/.build}/$target-$source_mode"
sketch="$build/Tg1bPi"
rm -rf "$sketch"
mkdir -p "$sketch"
python3 "$root/tools/embed_web.py" "$sketch/generated" >/dev/null
cp "$root"/src/*.h "$root"/src/*.cpp "$sketch/"
: > "$sketch/Tg1bPi.ino"

arduino-cli ${ARDUINO_CLI_CONFIG:+--config-file "$ARDUINO_CLI_CONFIG"} compile \
  --fqbn "$fqbn" \
  --library "$root/lib/tubepi" \
  --build-property "compiler.cpp.extra_flags=-DTUBEPI_SOURCE=$source_id ${TUBEPI_FLAGS:-}" \
  --output-dir "$build/out" \
  "$@" \
  "$sketch"
