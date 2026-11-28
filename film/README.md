# Film (or paper) calibration target

`particle_field_film_target_letter.pdf` is the tray's dot pattern at exact size, four copies on a US Letter page,
for an office inkjet or laser printer. It replaces the 3D-printed dots, which are hard to print cleanly.

## Printing
- Use **transparency film made for your printer type** (inkjet film has a coated, slightly tacky print side).
- Print at **100 % / Actual size**. Turn off "Fit to page" and "Scale to fit".
- Best quality, black or grayscale. On an Epson EcoTank choose a photo or premium paper type so it lays down more ink.
- Let it dry fully, then check the 100 mm bar on the page with a ruler.
- Cut one target along its grey outline (96 x 92 mm).

## Using it
1. Print the plain white tray, `print/1b_tray_plain_white.3mf`. The dotted trays cannot be used underneath, because their dots show through.
2. Lay the film on the plain tray with the word FRONT at the grip, **printed side down**, so particles sit on the smooth side and never touch the ink.
   Fix it with a small piece of tape at two corners, outside the dot grid.
3. Measure across 30 dot pitches with calipers (nominal 60.00 mm) and enter the result / 30 in the app under Settings > Tray dot pitch.
4. Use the stand and app exactly as with the printed tray.

Plain paper also works for a quick check without the stand's backlight.

`make_film_target.py` regenerates the PDF from `cad/layout.json` (needs `pip install reportlab`).
