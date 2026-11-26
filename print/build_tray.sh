#!/bin/bash
# Builds the tray v2 and test-coupon print projects. Run on the Mac (needs Bambu Studio installed).
cd "$(dirname "$0")"
B=/Applications/BambuStudio.app/Contents/MacOS/BambuStudio
T=/tmp/pfout; rm -rf $T; mkdir -p $T
M="flat/machine.json"; TR="flat/PF tray v2 0.20.json"
W="flat/PF PLA Matte White.json"; K="flat/PF PLA Matte Black.json"
run() { name=$1; shift; "$B" --debug 2 --orient 0 --arrange 1 --assemble --load-settings "$M;$TR" --load-filaments "$W;$K" --load-filament-ids "1,2" "$@" --export-3mf "$T/$name" > "log_$name.txt" 2>&1; echo "$name exit=$?"; }
run 0_test_coupon_white+black.3mf coupon_white.stl coupon_black.stl
run 1_tray_v2_white+black.3mf tray_white.stl tray_black.stl
# sliced copies, only to check filament use and time
run sliced_coupon.3mf --slice 0 coupon_white.stl coupon_black.stl
run sliced_tray.3mf --slice 0 tray_white.stl tray_black.stl
cp $T/0_*.3mf $T/1_*.3mf . && ls -la $T
