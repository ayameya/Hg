#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${TMPDIR:-/tmp}/tubepi-tests"
mkdir -p "$out"
c++ -std=c++17 -O2 -Wall -Wextra -Wpedantic -I"$root/lib/tubepi/src" "$root/tests/test_core.cpp" -o "$out/test_core"
"$out/test_core"
c++ -std=c++17 -O2 -Wall -Wextra -pthread -I"$root/lib/tubepi/src" "$root/tools/host_emulator.cpp" -o "$out/host_emulator"
echo "host emulator built: $out/host_emulator --web $root/web/index.html"
