#!/bin/bash
# Builds the side-lit test coupon (black plate, white dots). Run on the Mac (needs Bambu Studio installed).
cd "$(dirname "$0")"
B=/Applications/BambuStudio.app/Contents/MacOS/BambuStudio
T=/tmp/pfout; rm -rf $T; mkdir -p $T
"$B" --debug 2 --orient 0 --arrange 1 --assemble --load-settings "flat/machine.json;flat/PF tray v2 0.20.json" \
  --load-filaments "flat/PF PLA Matte White.json;flat/PF PLA Matte Black.json" --load-filament-ids "2,1" \
  coupon_dark_black.stl coupon_dark_white.stl ${SLICE:+--slice 0} --export-3mf "$T/0b_test_coupon_dark_black+white.3mf" > /dev/null 2>&1; echo "exit=$?"
[ -z "$SLICE" ] && cp $T/0b_*.3mf . ; ls -la $T
