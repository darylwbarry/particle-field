"""Generates the printable film/paper calibration target (PDF, exact scale) from cad/layout.json.
Run:  python3 film/make_film_target.py     (needs: pip install reportlab)
Print at 100 % ("Actual size"), best quality, on inkjet or laser transparency film or plain paper."""
import json, os
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.pagesizes import letter

HERE = os.path.dirname(os.path.abspath(__file__))
L = json.load(open(os.path.join(HERE, "..", "cad", "layout.json")))
P, D, NI, NJ = L["pitch_mm"], L["dot_d_mm"], L["ni"], L["nj"]
TRAY_W, TRAY_D, LAT_CX, LAT_CY = 96.0, 92.0, 48.0, 55.0     # same placement as the printed tray

def in_window(i, j):
    return any(w["i0"] <= i <= w["i1"] and w["j0"] <= j <= w["j1"] for w in L["windows"])

def target(c, x0, y0):
    """one tray-sized insert with its lower-left corner at (x0, y0) mm"""
    c.setStrokeGray(0.6); c.setLineWidth(0.15 * mm); c.rect(x0 * mm, y0 * mm, TRAY_W * mm, TRAY_D * mm)
    c.setFillGray(0)
    for i in range(NI):
        for j in range(NJ):
            if in_window(i, j): continue
            x = x0 + LAT_CX + (i - (NI - 1) / 2) * P; y = y0 + LAT_CY + (j - (NJ - 1) / 2) * P
            c.circle(x * mm, y * mm, D / 2 * mm, stroke=0, fill=1)
    c.setFillGray(0.35); c.setFont("Helvetica", 6.5)
    c.drawCentredString((x0 + TRAY_W / 2) * mm, (y0 + 20) * mm, f"PARTICLE FIELD film target  -  pitch {P:.3f} mm  -  FRONT (drawer grip side)")
    for w in L["windows"]:
        xc = x0 + LAT_CX + ((w["i0"] + w["i1"]) / 2 - (NI - 1) / 2) * P
        c.setFont("Helvetica-Bold", 9); c.drawCentredString(xc * mm, (y0 + 27) * mm, w["name"])

def main(out):
    c = canvas.Canvas(out, pagesize=letter); W, H = letter[0] / mm, letter[1] / mm
    c.setTitle("Particle Field film calibration target"); c.setAuthor("Particle Field")
    gx, gy = 6.0, 6.0
    X0 = (W - 2 * TRAY_W - gx) / 2; Y0 = 22.0
    for r in range(2):
        for k in range(2):
            target(c, X0 + k * (TRAY_W + gx), Y0 + r * (TRAY_D + gy))
    # scale check bar: 100.00 mm with end ticks
    yb = Y0 + 2 * TRAY_D + gy + 14; xb = (W - 100) / 2
    c.setStrokeGray(0); c.setLineWidth(0.2 * mm)
    c.line(xb * mm, yb * mm, (xb + 100) * mm, yb * mm)
    for t in range(0, 101, 10):
        h = 4 if t % 50 == 0 else 2.2
        c.line((xb + t) * mm, yb * mm, (xb + t) * mm, (yb + h) * mm)
    c.setFillGray(0); c.setFont("Helvetica", 8)
    c.drawCentredString(W / 2 * mm, (yb + 7) * mm, "Scale check: this bar must measure 100.0 mm end to end. If not, the print was scaled; reprint at 100 % / Actual size.")
    c.setFont("Helvetica-Bold", 11); c.drawCentredString(W / 2 * mm, (H - 14) * mm, "Particle Field calibration target for film or paper")
    c.setFont("Helvetica", 8)
    c.drawCentredString(W / 2 * mm, (H - 19) * mm, "Print at 100 % (Actual size), best quality, black only. Cut along the grey outlines. Four targets per page.")
    c.drawCentredString(W / 2 * mm, 12 * mm, "After printing, measure across 30 dot pitches (nominal 60.00 mm) and enter the result / 30 in Settings > Tray dot pitch.")
    c.showPage(); c.save()

if __name__ == "__main__":
    main(os.path.join(HERE, "particle_field_film_target_letter.pdf"))
    print("wrote PDF")
