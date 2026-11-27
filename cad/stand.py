"""
Particle Field stand — parametric CAD (CadQuery / OpenCASCADE, the same kernel FreeCAD uses).

Run:  python3 stand.py            -> writes STEP + STL for every part into ./out
Open the .step files directly in FreeCAD (File > Open) or Bambu Studio.

Parts
  base        white PLA. Light cavity (white = integrating box), drawer slot, light ports, tube + stacking rim.
  tray        white PLA diffuser plate with black PLA calibration-dot lattice (2-colour, print top face DOWN).
  spacer_10   black PLA light-tunnel riser, +10 mm.
  spacer_20   black PLA light-tunnel riser, +20 mm.
  deck        phone platform with camera aperture and alignment grooves.

Coordinates (assembled): X left-right, Y front-back (drawer enters at Y=0), Z up. Stand centre (70, 55).
"""
import json, os, math
import cadquery as cq

HERE = os.path.dirname(os.path.abspath(__file__))
L = json.load(open(os.path.join(HERE, "layout.json")))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

# ---------------- key dimensions (mm) ----------------
P = L["pitch_mm"]; DOT_D = L["dot_d_mm"]; NI = L["ni"]; NJ = L["nj"]
CX, CY = 70.0, 55.0              # stand centre = lattice centre when drawer fully in
BASE_X, BASE_Y = 140.0, 110.0
WALL = 3.0
FLOOR = 2.0
LEDGE_Z = 24.0                   # tray rests here
TRAY_H = 7.0                     # tray body height (top plane = LEDGE_Z + TRAY_H)
PLATE_T = 1.0                    # white diffuser plate thickness
DOT_DEPTH = 0.2                  # black dots are ONE layer deep, at the particle surface only (tray v2)
SLOT_CLEAR_Z = 0.6
SLOT_W = 97.0                    # tray is 96 wide
TRAY_W, TRAY_D = 96.0, 92.0
CHAMBER_X0, CHAMBER_X1 = 27.0, 113.0
ROOF_T = 4.0
TUBE_OX, TUBE_OY = 90.0, 64.0     # light tunnel outer
TUBE_IX, TUBE_IY = 82.0, 56.0     # light tunnel inner
RIM_OX, RIM_OY = 86.0, 60.0       # stacking rim (male), 2 mm tall
RIM_H = 2.0
RIM_CLEAR = 0.2                   # per side
MATE_TO_TRAY = 16.0               # base mating plane is 16 mm above tray top plane
DECK_X, DECK_Y, DECK_T = 200.0, 110.0, 5.0
APER_X, APER_Y = 76.0, 50.0

TRAY_TOP_Z = LEDGE_Z + TRAY_H                 # 31.0
SLOT_TOP_Z = TRAY_TOP_Z + SLOT_CLEAR_Z         # 31.6
ROOF_TOP_Z = SLOT_TOP_Z + ROOF_T               # 33.6
BASE_MATE_Z = TRAY_TOP_Z + MATE_TO_TRAY        # 47.0

def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))

def cbox(cx, cy, sx, sy, z0, z1):
    return box(cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, z0, z1)

def ring(cx, cy, ox, oy, ix, iy, z0, z1):
    return cbox(cx, cy, ox, oy, z0, z1).cut(cbox(cx, cy, ix, iy, z0 - 1, z1 + 1))

def rim_and_recess(solid, z_mate, z_bottom=None):
    """Add male rim on top at z_mate; cut female recess at z_bottom (if given)."""
    solid = solid.union(ring(CX, CY, RIM_OX, RIM_OY, TUBE_IX, TUBE_IY, z_mate, z_mate + RIM_H))
    if z_bottom is not None:
        rx, ry = RIM_OX + 2 * RIM_CLEAR, RIM_OY + 2 * RIM_CLEAR
        solid = solid.cut(cbox(CX, CY, rx, ry, z_bottom - 1, z_bottom + RIM_H + 0.0))
    return solid

# ---------------- lattice geometry ----------------
def dot_xy(i, j):
    return ((i - (NI - 1) / 2) * P, (j - (NJ - 1) / 2) * P)

def in_window(i, j):
    return any(w["i0"] <= i <= w["i1"] and w["j0"] <= j <= w["j1"] for w in L["windows"])

def roi(w):
    r, m = DOT_D / 2, L["roi_margin_mm"]
    x0 = dot_xy(w["i0"] - 1, 0)[0] + r + m; x1 = dot_xy(w["i1"] + 1, 0)[0] - r - m
    y0 = dot_xy(0, w["j0"] - 1)[1] + r + m; y1 = dot_xy(0, w["j1"] + 1)[1] - r - m
    return x0, x1, y0, y1

DOTS = [(i, j) for i in range(NI) for j in range(NJ) if not in_window(i, j)]

# ---------------- BASE (two parts, both print without supports) ----------------
PEG_D, PEG_H, PEG_CLEAR = 4.0, 2.6, 0.2
PEGS = [(10, 10), (BASE_X - 10, 10), (10, BASE_Y - 10), (BASE_X - 10, BASE_Y - 10)]

def make_base_body():
    """Floor, light cavity, ledges for the drawer, light ports. Open on top. Print floor down."""
    b = box(0, BASE_X, 0, BASE_Y, 0, SLOT_TOP_Z)
    b = b.cut(box(CHAMBER_X0, CHAMBER_X1, WALL, BASE_Y - WALL, FLOOR, LEDGE_Z + 0.01))
    sx0 = CX - SLOT_W / 2
    b = b.cut(box(sx0, sx0 + SLOT_W, -1, BASE_Y - WALL, LEDGE_Z, SLOT_TOP_Z + 1))
    # light ports as several narrow openings (short bridges)
    for k in range(4):
        x0 = 34 + k * 19
        b = b.cut(box(x0, x0 + 15, BASE_Y - WALL - 1, BASE_Y + 1, 5, LEDGE_Z - 2))
    for k in range(3):
        y0 = 32 + k * 16
        b = b.cut(box(-1, CHAMBER_X0 + 1, y0, y0 + 12, 5, LEDGE_Z - 2))
    ramp = (cq.Workplane("YZ").polyline([(WALL, FLOOR), (WALL, 14.0), (BASE_Y - WALL - 8, FLOOR)]).close()
            .extrude(CHAMBER_X1 - CHAMBER_X0).translate((CHAMBER_X0, 0, 0)))
    b = b.union(ramp)
    for (px, py) in PEGS:
        b = b.union(cq.Workplane("XY").circle(PEG_D / 2).extrude(PEG_H).translate((px, py, SLOT_TOP_Z)).edges(">Z").chamfer(0.5))
    for fx, fy in [(12, 12), (BASE_X - 12, 12), (12, BASE_Y - 12), (BASE_X - 12, BASE_Y - 12)]:
        b = b.cut(cq.Workplane("XY").circle(5.3).extrude(0.8).translate((fx, fy, 0)))
    try:
        t = (cq.Workplane("XZ").text("PARTICLE FIELD", 5, -0.6, kind="bold", halign="center", valign="center").translate((CX, 0, 12)))
        b = b.cut(t)
    except Exception as e:
        print("text skipped:", e)
    return b

def make_base_lid():
    """Roof over the drawer + light tunnel + stacking rim. Print roof (flat side) down."""
    l = box(0, BASE_X, 0, BASE_Y, SLOT_TOP_Z, ROOF_TOP_Z)
    l = l.cut(cbox(CX, CY, TUBE_IX, TUBE_IY, SLOT_TOP_Z - 1, ROOF_TOP_Z + 1))
    l = l.union(ring(CX, CY, TUBE_OX, TUBE_OY, TUBE_IX, TUBE_IY, ROOF_TOP_Z - 0.01, BASE_MATE_Z))
    l = rim_and_recess(l, BASE_MATE_Z)
    for (px, py) in PEGS:
        l = l.cut(cq.Workplane("XY").circle(PEG_D / 2 + PEG_CLEAR).extrude(PEG_H + 0.4).translate((px, py, SLOT_TOP_Z - 0.01)))
    l = l.edges("|Z").fillet(1.0) if False else l
    return l

# ---------------- TRAY (as used, top plane at local z=TRAY_H) ----------------
LAT_CX, LAT_CY = TRAY_W / 2, CY   # lattice centre in tray-local coords (tray front face at y=0)

def make_tray():
    zt = TRAY_H
    body = box(0, TRAY_W, 0, TRAY_D, zt - PLATE_T, zt)                    # diffuser plate
    body = body.union(ring(TRAY_W / 2, TRAY_D / 2, TRAY_W, TRAY_D, TRAY_W - 6, TRAY_D - 6, 0, zt))  # frame
    # v2: no ribs under the plate. In v1 they showed up as shadow bands across the dot grid when backlit.
    # front face plate (covers slot) + grip
    body = body.union(box(-4, TRAY_W + 4, -3, 0.01, -2, zt))
    body = body.union(cq.Workplane("XY").box(24, 6, zt + 2, centered=(True, False, False))
                      .translate((TRAY_W / 2, -9, -2)).edges("|Z").fillet(2.5))
    # black inlays
    dots = None
    for (i, j) in DOTS:
        x, y = dot_xy(i, j)
        c = cq.Workplane("XY").circle(DOT_D / 2).extrude(DOT_DEPTH).translate((LAT_CX + x, LAT_CY + y, zt - DOT_DEPTH))
        dots = c if dots is None else dots.union(c, clean=False)
    black = dots
    # window corner ticks? no - windows are simply dot-free. Labels in front margin (0.4 mm deep inlay).
    try:
        lab = (cq.Workplane("XY").workplane(offset=zt - DOT_DEPTH)
               .text(f"PARTICLE FIELD  v2  -  PITCH {P:.1f} mm", 3.2, DOT_DEPTH, kind="bold", halign="center", valign="center")
               .translate((TRAY_W / 2, 18, 0)))
        lab2 = (cq.Workplane("XY").workplane(offset=zt - DOT_DEPTH)
                .text("L                    S", 4.0, DOT_DEPTH, kind="bold", halign="center", valign="center")
                .translate((TRAY_W / 2 + 4, 9.5, 0)))
        black = black.union(lab).union(lab2)
    except Exception as e:
        print("text skipped:", e)
    # window outline ticks: 4 small L-corner marks just outside each ROI are NOT added (they would look like particles)
    white = body.cut(black)
    return white, black

# ---------------- TEST COUPON (10-minute print to check dot quality before the full tray) ----------------
def make_coupon(ni=13, nj=9, win=(5, 7, 4, 5), dot_depth=None, margin=4.0, t=1.0):
    """Flat plate, printed dot-face down like the tray. Dots are missing inside win = (i0, i1, j0, j1).
    Default: 13 x 9 dots with a 3 x 2 window (the app reads it as window S). Returns (plate, dots)."""
    depth = DOT_DEPTH if dot_depth is None else dot_depth
    w, h = (ni - 1) * P + 2 * margin, (nj - 1) * P + 2 * margin
    body = box(0, w, 0, h, 0, t)
    dots = None
    for i in range(ni):
        for j in range(nj):
            if win[0] <= i <= win[1] and win[2] <= j <= win[3]: continue
            c = cq.Workplane("XY").circle(DOT_D / 2).extrude(depth).translate((margin + i * P, margin + j * P, 0))
            dots = c if dots is None else dots.union(c, clean=False)
    return body.cut(dots), dots

def make_coupon_dark():
    """Side-lit test coupon: BLACK plate with WHITE dots and a window-L sized clear area (18 x 12 mm).
    The white dots go through the full plate thickness so they look white, not grey, against the black."""
    return make_coupon(ni=13, nj=10, win=(2, 10, 2, 7), dot_depth=1.0)

# ---------------- SPACERS ----------------
def make_spacer(h):
    s = ring(CX, CY, TUBE_OX, TUBE_OY, TUBE_IX, TUBE_IY, 0, h)
    s = rim_and_recess(s, h, z_bottom=0)
    # matte internal baffle grooves reduce glancing reflections off the inner walls
    for z in [h * 0.33, h * 0.66]:
        s = s.cut(ring(CX, CY, TUBE_IX + 1.2, TUBE_IY + 1.2, TUBE_IX - 0.01, TUBE_IY - 0.01, z - 0.6, z + 0.6))
    return s

# ---------------- DECK ----------------
def make_deck():
    d = cbox(CX, CY, DECK_X, DECK_Y, 0, DECK_T).edges("|Z").fillet(6)
    d = d.cut(cbox(CX, CY, APER_X, APER_Y, -1, DECK_T + 1).edges("|Z").fillet(3))
    rx, ry = RIM_OX + 2 * RIM_CLEAR, RIM_OY + 2 * RIM_CLEAR
    d = d.cut(cbox(CX, CY, rx, ry, -1, RIM_H))
    # alignment grooves on top: Y centreline, and X lines through each window centre
    g = 0.6
    d = d.cut(box(CX - DECK_X / 2, CX + DECK_X / 2, CY - 0.4, CY + 0.4, DECK_T - g, DECK_T + 1))
    for w in L["windows"]:
        x0, x1, _, _ = roi(w)
        xc = CX + (x0 + x1) / 2
        for y0, y1 in [(CY - DECK_Y / 2, CY - APER_Y / 2), (CY + APER_Y / 2, CY + DECK_Y / 2)]:
            d = d.cut(box(xc - 0.4, xc + 0.4, y0, y1, DECK_T - g, DECK_T + 1))
        try:
            t = (cq.Workplane("XY").workplane(offset=DECK_T - g)
                 .text(w["name"], 6, g + 1, kind="bold", halign="center", valign="center")
                 .translate((xc + 5, CY + APER_Y / 2 + 8, 0)))
            d = d.cut(t)
        except Exception as e:
            print("text skipped:", e)
    return d

def export(shape, name):
    cq.exporters.export(shape, os.path.join(OUT, name + ".step"))
    cq.exporters.export(shape, os.path.join(OUT, name + ".stl"), tolerance=0.01, angularTolerance=0.1)
    bb = shape.val().BoundingBox()
    print(f"{name:14s} {bb.xlen:7.1f} x {bb.ylen:7.1f} x {bb.zlen:6.1f} mm  vol {shape.val().Volume()/1000:7.1f} cm3")

if __name__ == "__main__":
    body = make_base_body(); export(body, "base_body")
    lid = make_base_lid(); export(lid.translate((0, 0, -SLOT_TOP_Z)), "base_lid")
    base = body.union(lid)
    white, black = make_tray()
    # print orientation: top plane down (flip about X), both bodies share the same transform
    flip = lambda s: s.rotate((0, 0, 0), (1, 0, 0), 180).translate((0, 0, TRAY_H))
    export(flip(white), "tray_white"); export(flip(black), "tray_black")
    cw, cb = make_coupon(); export(cw, "coupon_white"); export(cb, "coupon_black")
    dk, dw = make_coupon_dark(); export(dk, "coupon_dark_black"); export(dw, "coupon_dark_white")
    asm_tray = cq.Assembly()
    asm_tray.add(flip(white), name="tray_white", color=cq.Color(0.95, 0.95, 0.95))
    asm_tray.add(flip(black), name="tray_black", color=cq.Color(0.05, 0.05, 0.05))
    asm_tray.save(os.path.join(OUT, "tray_2color.step"))
    export(make_spacer(10), "spacer_10")
    export(make_spacer(20), "spacer_20")
    deck = make_deck(); export(deck, "deck")
    # assembled preview (drawer in, one 10 mm spacer)
    a = cq.Assembly()
    a.add(base, name="base", color=cq.Color(0.93, 0.93, 0.93))
    tz = (CX - TRAY_W / 2, 0, LEDGE_Z)
    a.add(white.translate(tz), name="tray", color=cq.Color(1, 1, 1))
    a.add(black.translate(tz), name="dots", color=cq.Color(0.05, 0.05, 0.05))
    a.add(make_spacer(10).translate((0, 0, BASE_MATE_Z)), name="spacer10", color=cq.Color(0.12, 0.12, 0.12))
    a.add(deck.translate((0, 0, BASE_MATE_Z + 10)), name="deck", color=cq.Color(0.2, 0.45, 0.8))
    a.save(os.path.join(OUT, "assembly.step"))
    # ROI table for the app
    for w in L["windows"]:
        print("ROI", w["name"], ["%.2f" % v for v in roi(w)])
    print("tray top plane z =", TRAY_TOP_Z, " deck top (no spacer) =", BASE_MATE_Z + DECK_T,
          " phone-to-sample (no spacer) =", BASE_MATE_Z + DECK_T - TRAY_TOP_Z)
