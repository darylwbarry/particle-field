# Print files for the Bambu Lab P1S (0.4 mm nozzle)

Open each `.3mf` in Bambu Studio (File > Open Project), check the filament mapping to your AMS slots, slice, print.

| File | Filament | Time / material | Notes |
|---|---|---|---|
| `0_test_coupon_white+black.3mf` | White = 1, Black = 2 (AMS) | about 8 min, 2 g | 32 x 24 mm coupon with the same dots as the tray. Print it first to check dot quality. |
| `0b_test_coupon_dark_black+white.3mf` | White = 1 (dots), Black = 2 (plate) | about 18 min, 4 g | Side-lit test coupon: black plate, white dots, 18 x 12 mm clear area. For bright particles such as salt, lit from the side. White dots go through the full 1 mm so they look white against the black. Rebuild with `./build_coupon_dark.sh`. |
| `1_tray_v2_white+black.3mf` | White = 1, Black = 2 (AMS) | about 46 min, 23 g white, 0.4 g black | Calibration tray v2. Dot face down, as exported. |
| `2_base_body_white.3mf` | White | | Floor down. 3 walls, 15 % gyroid. |
| `3_lid_spacers_black.3mf` | Black | | Lid (roof down) + 10 mm spacer + 2 x 20 mm spacers on one plate. |
| `4_deck_white.3mf` | White | | Grooves up. |

## Tray v2: what changed and why

The first tray printed with dots about 1.7 mm wide instead of 1.0 mm, and with grey halos on the particle face.
The black went through all five layers of the plate, and each small black island grew wider with every layer.
The wider black underneath then showed through the white surface.

- **Black is now one layer deep (0.2 mm), on the particle face only.** Nothing wider sits underneath to show through.
  It also cuts the print to two filament changes in total (white, black, white), all in the first two layers.
- **No ribs under the plate.** They crossed the dot grid and would cast shadow bands when lit from below.
- Dot positions, pitch (2.000 mm) and windows are unchanged, so the app needs no change.

## Settings in the tray and coupon files (preset "PF tray v2 0.20")

| Setting | Value | Why |
|---|---|---|
| Layer height / first layer | 0.20 / 0.20 mm | The black dots are exactly one first layer thick |
| First layer line width | 0.42 mm (default 0.50) | Finer lines resolve 1 mm dots better |
| First layer speed | 30 mm/s walls, 60 mm/s infill (default 50 / 105) | Small circles print cleaner slowly |
| Wall generator | Arachne | Varies line width to fill 1 mm circles and the holes around them |
| Elephant foot compensation | 0 | Otherwise the slicer shrinks the first layer, which is the dot layer |
| X-Y hole / contour compensation | 0 | Keeps dot spacing as designed |
| Small perimeters | 50 % speed, threshold 4 mm | Slows the tiny dot outlines |
| Prime tower | On | Clean colour changes (only the first two layers use it) |
| Plate | Textured PEI | Matte particle surface, less glare |
| Ironing, supports, brim | Off | Not needed |
| Filament profile | Bambu PLA Matte, white + black | Use Bambu PLA Basic if that is what you have |

In layer 1 the slicer prints the white first and then drops the black dots into the holes, so the white bounds each dot.

**Before printing:** a clean plate matters more than usual, because 660 small black dots must stick on their own.
Wash the plate with dish soap and water, dry it, and don't touch the print area.

**Checking the coupon:** photograph its smooth face in the app. It has a 3 x 2 window, so the app reads it as window S.
The dots should look separate, about 1 mm wide, with white between them and no grey halo.

## Rebuilding

After a CAD change, copy the new STLs from `cad/out/` into this folder and run on the Mac:
`./build_tray.sh` (coupon and tray) or `./build.sh` (base, lid and spacers, deck).
They drive Bambu Studio's command-line slicer with the flattened presets in `flat/`.
`presets/` holds the readable overrides; `python3 flatten.py` regenerates `flat/` from them and the Bambu profiles in `_bbl/`.
