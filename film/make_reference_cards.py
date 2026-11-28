"""Generates the Quick-estimate reference cards (PDF, exact scale): white and black sides, two open-area sizes.
Run:  python3 film/make_reference_cards.py    (needs: pip install reportlab)   -> www/reference_cards.pdf
Print at 100 % ("Actual size") on heavy matte paper. Fold each pair along the dashed line and glue it back to back."""
import os
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.pagesizes import letter

HERE = os.path.dirname(os.path.abspath(__file__))
P, D = 2.0, 1.0                      # dot pitch and diameter, mm (must match LAYOUT in www/core.js)
CW, CH = 85.6, 54.0                  # credit-card size
KINDS = {                            # lattice size and the block of missing dots (the open area)
    "XL": dict(ni=24, nj=17, win=(2, 21, 2, 14), area="40 x 26 mm"),
    "L":  dict(ni=13, nj=10, win=(2, 10, 2, 7),  area="18 x 12 mm"),
}

def card(c, x0, y0, kind, black):
    k = KINDS[kind]; ni, nj, (i0, i1, j0, j1) = k["ni"], k["nj"], k["win"]
    fg, bgc = (1, 0) if black else (0, 1)
    c.setFillGray(bgc); c.setStrokeGray(0.6); c.setLineWidth(0.15 * mm)
    c.rect(x0 * mm, y0 * mm, CW * mm, CH * mm, stroke=1, fill=1)
    cx, cy = x0 + CW / 2, y0 + CH / 2 + 2.5
    c.setFillGray(fg)
    for i in range(ni):
        for j in range(nj):
            if i0 <= i <= i1 and j0 <= j <= j1: continue
            c.circle((cx + (i - (ni - 1) / 2) * P) * mm, (cy + (j - (nj - 1) / 2) * P) * mm, D / 2 * mm, stroke=0, fill=1)
    c.setFillGray(0.75 if black else 0.3); c.setFont("Helvetica", 5.5)
    side = "BLACK side: light particles" if black else "WHITE side: dark particles"
    c.drawCentredString((x0 + CW / 2) * mm, (y0 + 3.2) * mm, f"Particle Field reference card {kind}  -  open area {k['area']}  -  pitch {P:.3f} mm  -  {side}")

def main(out):
    c = canvas.Canvas(out, pagesize=letter); W, H = letter[0] / mm, letter[1] / mm
    c.setTitle("Particle Field reference cards"); c.setAuthor("Particle Field")
    c.setFillGray(0); c.setFont("Helvetica-Bold", 11); c.drawCentredString(W / 2 * mm, (H - 12) * mm, "Particle Field reference cards (Quick estimate)")
    c.setFont("Helvetica", 7.5)
    c.drawCentredString(W / 2 * mm, (H - 16.5) * mm, "Print at 100 % (Actual size), best quality, on heavy matte paper. Cut out each white + black pair, fold on the dashed line, glue back to back.")
    c.drawCentredString(W / 2 * mm, (H - 20) * mm, "Sprinkle the sample in the open area. White side for dark particles, black side for light ones. Photograph from straight above in even light.")
    X0 = (W - 2 * CW) / 2; gap = 4.5; y = H - 26 - CH
    for kind in ("XL", "XL", "L", "L"):
        card(c, X0, y, kind, False); card(c, X0 + CW, y, kind, True)
        c.setStrokeGray(0.5); c.setLineWidth(0.15 * mm); c.setDash(1.5 * mm, 1.2 * mm)
        c.line((X0 + CW) * mm, (y - 1.5) * mm, (X0 + CW) * mm, (y + CH + 1.5) * mm); c.setDash()
        y -= CH + gap
    yb = y + CH - 6; xb = (W - 100) / 2
    c.setStrokeGray(0); c.setLineWidth(0.2 * mm); c.line(xb * mm, yb * mm, (xb + 100) * mm, yb * mm)
    for t in range(0, 101, 10): c.line((xb + t) * mm, yb * mm, (xb + t) * mm, (yb + (3.5 if t % 50 == 0 else 2)) * mm)
    c.setFillGray(0); c.setFont("Helvetica", 7.5)
    c.drawCentredString(W / 2 * mm, (yb - 4) * mm, "Scale check: this bar must measure 100.0 mm. If it does not, the print was scaled; reprint at 100 % / Actual size.")
    c.showPage(); c.save()

if __name__ == "__main__":
    out = os.path.join(HERE, "..", "www", "reference_cards.pdf"); main(out); print("wrote", os.path.normpath(out))
