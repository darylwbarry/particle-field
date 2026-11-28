#!/bin/bash
# Builds the plain white tray (diffuser for the film target). Run on the Mac (needs Bambu Studio installed).
cd "$(dirname "$0")"
B=/Applications/BambuStudio.app/Contents/MacOS/BambuStudio
T=/tmp/pfout; rm -rf $T; mkdir -p $T
"$B" --debug 2 --orient 0 --arrange 1 --load-settings "flat/machine.json;flat/PF tray v2 0.20.json" \
  --load-filaments "flat/PF PLA Matte White.json" tray_plain_white.stl ${SLICE:+--slice 0} --export-3mf "$T/1b_tray_plain_white.3mf" > /dev/null 2>&1; echo "exit=$?"
[ -z "$SLICE" ] && cp $T/1b_*.3mf . ; ls -la $T
