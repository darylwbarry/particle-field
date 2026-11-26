#!/bin/bash
# Builds Bambu Studio project files for the P1S. Run on the Mac (needs Bambu Studio installed).
cd "$(dirname "$0")"
B=/Applications/BambuStudio.app/Contents/MacOS/BambuStudio
T=/tmp/pfout; rm -rf $T; mkdir -p $T
M="flat/machine.json"; S="flat/PF structural 0.20.json"; TR="flat/PF tray 0.20.json"
W="flat/PF PLA Matte White.json"; K="flat/PF PLA Matte Black.json"
run() { name=$1; shift; "$B" --debug 2 --orient 0 "$@" --export-3mf "$T/$name" > "log_$name.txt" 2>&1; echo "$name exit=$?"; }
run 1_tray_white+black.3mf --arrange 1 --assemble --load-settings "$M;$TR" --load-filaments "$W;$K" --load-filament-ids "1,2" tray_white.stl tray_black.stl
run 2_base_body_white.3mf  --arrange 1 --load-settings "$M;$S" --load-filaments "$W" base_body.stl
run 3_lid_spacers_black.3mf --arrange 1 --allow-rotations --load-settings "$M;$S" --load-filaments "$K" base_lid.stl spacer_10.stl spacer_20.stl spacer_20.stl
run 4_deck_white.3mf       --arrange 1 --load-settings "$M;$S" --load-filaments "$W" deck.stl
cp $T/*.3mf . && ls -la *.3mf
