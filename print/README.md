# Print files for the Bambu Lab P1S (0.4 mm nozzle)

Open each `.3mf` in Bambu Studio (File > Open Project), check the filament mapping to your AMS slots, slice, print.

| File | Filament | Plate | Notes |
|---|---|---|---|
| `1_tray_white+black.3mf` | White = filament 1, Black = filament 2 (AMS) | Textured PEI | Dots-down, as it must be. No elephant-foot or XY compensation; prime tower on. |
| `2_base_body_white.3mf` | White | Textured PEI | Floor down. 3 walls, 15 % gyroid. |
| `3_lid_spacers_black.3mf` | Black | Textured PEI | Lid (roof down) + 10 mm spacer + 2 x 20 mm spacers on one plate. |
| `4_deck_white.3mf` | White | Textured PEI | Grooves up. |

Common settings: 0.20 mm layers (0.20mm Standard @BBL X1C base), 3 walls, 5 top / 4 bottom layers,
no supports, no brim, Bambu PLA Matte profile. No part needs supports.

The tray's top surface (the side the particles sit on) prints against the plate. Textured PEI gives
a matte surface that cuts glare; a smooth plate works too.

To rebuild after a CAD change: copy the new STLs from `cad/out/` into this folder and run `./build.sh` on the Mac.
It drives Bambu Studio's command-line slicer with the flattened presets in `flat/`
(`presets/` holds the human-readable overrides; `flatten.py` regenerates `flat/` from them and the
Bambu profiles copied to `_bbl/`).
