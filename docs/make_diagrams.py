"""Generates the step-by-step usage diagrams in docs/img/ (plain SVG, no dependencies).
Run:  python3 docs/make_diagrams.py
Geometry follows cad/stand.py and cad/layout.json (mm), so the drawings are to scale."""
import os, random, math

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "img")
os.makedirs(OUT, exist_ok=True)
INK, MUTE, LINE, ACC = "#1f2a33", "#5a6872", "#9aa7b0", "#0f6fae"
WHITE_P, BLACK_P, DECK, PHONE = "#f1f3f4", "#2b3238", "#bcd3f2", "#c9ced2"
SUN, GOOD, WARN, BAD, ROI = "#f2a900", "#11845b", "#b26a00", "#c02f3c", "#e0a800"
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
esc = lambda t: str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

# lattice (layout.json)
P, NI, NJ, DOT = 2.0, 33, 22, 1.0
WIN = {"L": (6, 14, 8, 13), "S": (22, 24, 10, 11)}
ROIS = {"L": (-21, -3, -6, 6), "S": (11, 17, -2, 2)}
def dots():
    for i in range(NI):
        for j in range(NJ):
            if any(a <= i <= b and c <= j <= e for a, b, c, e in WIN.values()): continue
            yield (i - (NI - 1) / 2) * P, (j - (NJ - 1) / 2) * P


class D:
    def __init__(s, n, title, w=760, h=420):
        s.w, s.h, s.e = w, h, []
        s.circle(34, 34, 19, fill=ACC, stroke="none")
        s.text(34, 41, n, 20, "#fff", "middle", "700")
        s.text(64, 41, title, 21, INK, "start", "650")
        s.line(20, 62, w - 20, 62, LINE, 1)
    def add(s, x): s.e.append(x)
    def rect(s, x, y, w, h, fill="none", stroke=INK, sw=1.5, rx=0, extra=""):
        s.add(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" {extra}/>')
    def circle(s, x, y, r, fill="none", stroke=INK, sw=1.5, extra=""):
        s.add(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.2f}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" {extra}/>')
    def line(s, x1, y1, x2, y2, col=INK, sw=1.5, extra=""):
        s.add(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{col}" stroke-width="{sw}" {extra}/>')
    def poly(s, pts, fill="none", stroke=INK, sw=1.5, extra=""):
        s.add(f'<polygon points="{" ".join(f"{x:.1f},{y:.1f}" for x, y in pts)}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round" {extra}/>')
    def arrow(s, x1, y1, x2, y2, col=ACC, sw=3):
        a = math.atan2(y2 - y1, x2 - x1); L = 11
        bx, by = x2 - L * math.cos(a), y2 - L * math.sin(a)
        s.line(x1, y1, bx, by, col, sw, 'stroke-linecap="round"')
        s.poly([(x2, y2), (bx - 5.5 * math.sin(a), by + 5.5 * math.cos(a)), (bx + 5.5 * math.sin(a), by - 5.5 * math.cos(a))], col, col, 1)
    def text(s, x, y, t, size=14, fill=INK, anchor="start", weight="400"):
        lines = t if isinstance(t, list) else [t]
        for k, ln in enumerate(lines):
            s.add(f'<text x="{x:.1f}" y="{y + k * size * 1.35:.1f}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" font-weight="{weight}">{esc(ln)}</text>')
    def note(s, x, y, head, body=None, col=INK):
        s.text(x, y, head, 14.5, col, "start", "650")
        if body: s.text(x, y + 19, body, 13, MUTE)
    def leader(s, x1, y1, x2, y2):
        s.line(x1, y1, x2, y2, MUTE, 1); s.circle(x1, y1, 2.2, MUTE, "none")
    def save(s, name):
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s.w} {s.h}" width="{s.w}" height="{s.h}" font-family="{FONT}">'
               f'<rect width="{s.w}" height="{s.h}" fill="#ffffff"/>' + "".join(s.e) + "</svg>")
        open(os.path.join(OUT, name + ".svg"), "w").write(svg); print("wrote", name)


def lattice(d, cx, cy, k, flip=True, clip=None, col=INK):
    """dots around lattice centre (cx,cy), k px/mm"""
    for x, y in dots():
        X, Y = cx + x * k, cy - y * k if flip else cy + y * k
        if clip and not (clip[0] <= X <= clip[2] and clip[1] <= Y <= clip[3]): continue
        d.circle(X, Y, DOT / 2 * k, col, "none")

def particles(d, x, y, w, h, n, rmin, rmax, seed, col="#30363b"):
    r = random.Random(seed)
    for _ in range(n):
        rr = rmin + (rmax - rmin) * r.random() ** 2.2
        d.add(f'<ellipse cx="{x + rr + r.random() * (w - 2 * rr):.1f}" cy="{y + rr + r.random() * (h - 2 * rr):.1f}" rx="{rr:.2f}" ry="{rr * (0.7 + 0.3 * r.random()):.2f}" fill="{col}" transform=""/>')


# ---------------------------------------------------------------- 0 pitch
def d_pitch():
    d = D("★", "One time: measure the dot pitch of your printed tray", h=330)
    k, y = 17, 190
    xs = [90 + i * 2 * k for i in range(6)]
    xr = [470 + i * 2 * k for i in range(4)]         # dots 28..31
    d.rect(60, 130, 640, 120, "#fafbfb", LINE, 1, 8)
    for x in xs + xr: d.circle(x, y, k / 2, INK, "none")
    d.text(302, 196, "· · ·", 26, MUTE, "middle", "700")
    d.text(410, 196, "· · ·", 26, MUTE, "middle", "700")
    for i, x in enumerate(xs[:3]): d.text(x, y + 30, str(i), 12, MUTE, "middle")
    for i, x in enumerate(xr[:3]): d.text(x, y + 30, str(28 + i), 12, MUTE, "middle")
    a, b = xs[0] - k / 2, xr[2] - k / 2               # left edge dot 0, left edge dot 30
    for x in (a, b):
        d.line(x, 100, x, y + 14, ACC, 2)
    d.rect(a - 3, 92, b - a + 6, 10, "#dfe9f2", ACC, 1.5, 2)
    d.text((a + b) / 2, 84, "calipers: left edge of dot 0  →  left edge of dot 30   (nominal 60.00 mm)", 14, ACC, "middle", "650")
    d.text(60, 284, "Enter (measured distance ÷ 30) in Settings → Tray dot pitch.   Example: 59.88 ÷ 30 = 1.9960 mm", 14, INK, "start", "650")
    d.text(60, 306, "Do it along a row and along a column. This one number sets the absolute scale of every result.", 13, MUTE)
    d.save("step0_pitch")


# ---------------------------------------------------------------- 1 assemble (front view, exploded)
def d_assemble():
    d = D("1", "Assemble the stand", h=440)
    k, cx, g = 2.3, 270, 28
    y = 415
    def box(wmm, hmm, fill, yb, rx=0): d.rect(cx - wmm * k / 2, yb - hmm * k, wmm * k, hmm * k, fill, INK, 1.5, rx)
    # base body with drawer slot + tray face
    box(140, 31.6, WHITE_P, y)
    d.rect(cx - 97 * k / 2, y - 31.6 * k, 97 * k, 7.6 * k, "#ffffff", INK, 1.2)
    d.rect(cx - 104 * k / 2, y - 31 * k, 104 * k, 9 * k, "#ffffff", INK, 1.5, 2)
    d.rect(cx - 12 * k, y - 31 * k, 24 * k, 9 * k, "#e3e7ea", INK, 1.2, 4)
    d.text(cx, y - 8 * k, "PARTICLE FIELD", 11, LINE, "middle", "700")
    y1 = y - 31.6 * k
    # lid
    yb = y1 - g; box(140, 4, BLACK_P, yb); box(90, 11.4, BLACK_P, yb - 4 * k); box(86, 2, BLACK_P, yb - 15.4 * k)
    y2 = yb - 17.4 * k
    # spacer
    yb = y2 - g; box(90, 10, BLACK_P, yb); box(86, 2, BLACK_P, yb - 10 * k)
    d.rect(cx - 90 * k / 2 - 5, yb - 12 * k - 5, 90 * k + 10, 12 * k + 10, "none", MUTE, 1, 4, 'stroke-dasharray="5 4"')
    y3 = yb - 12 * k
    # deck
    yb = y3 - g; box(200, 5, DECK, yb, 2); y4 = yb - 5 * k
    # phone
    yb = y4 - g; box(163, 8, PHONE, yb, 6)
    d.rect(cx - 20 * k, yb - 0.5, 14 * k, 3.5, "#6b747b", INK, 1, 1)
    for yt in (y4, y3, y2, y1):
        d.arrow(cx, yt - g + 5, cx, yt - 4, ACC, 2.5)
    X = 525
    items = [(y4 - g - 8 * k / 2 - 4, "5  Phone, screen up", "camera lens over the opening"),
             (y4 + 5 * k / 2, "4  Deck", "sits on the rim, grooves up"),
             (y3 + 6 * k, "3  Spacer(s) – only if needed", "10 mm / 20 mm, to reach focus"),
             (y2 + 9 * k, "2  Lid (black)", "drops onto the 4 pegs"),
             (y1 + 14 * k, "1  Base body (white)", "on a flat surface, drawer at the front")]
    for yy, hd, bd in items: d.note(X, yy - 4, hd, bd)
    d.text(40, 84, "front view, exploded", 12, MUTE)
    d.save("step1_assemble")


# ---------------------------------------------------------------- 2 load sample (top view of tray)
def d_load():
    d = D("2", "Pull the drawer out and spread the sample", h=470)
    k, x0, y0 = 3.3, 40, 82
    W, Hh = 96 * k, 92 * k
    d.rect(x0 - 4 * k, y0 + Hh, 104 * k, 3 * k, "#e3e7ea", INK, 1.5, 2)                 # face plate
    d.rect(x0 + 36 * k, y0 + Hh + 3 * k, 24 * k, 6 * k, "#e3e7ea", INK, 1.5, 6)          # grip
    d.rect(x0, y0, W, Hh, "#ffffff", INK, 1.8, 3)
    d.rect(x0 + 3 * k, y0 + 3 * k, W - 6 * k, Hh - 6 * k, "none", LINE, 1)
    cx, cy = x0 + 48 * k, y0 + (92 - 55) * k
    lattice(d, cx, cy, k)
    for nm, (a, b, c, e) in ROIS.items():
        d.rect(cx + a * k, cy - e * k, (b - a) * k, (e - c) * k, "none", ACC, 1.6, 2, 'stroke-dasharray="5 3"')
    a, b, c, e = ROIS["L"]
    particles(d, cx + a * k + 3, cy - e * k + 3, (b - a) * k - 6, (e - c) * k - 6, 45, 0.5, 1.7, 3)
    d.leader(cx + b * k, cy - 5 * k, 402, 92); d.leader(cx + 17 * k, cy - 1 * k, 402, 142)
    d.arrow(x0 + 48 * k, y0 + Hh + 3 * k + 26, x0 + 48 * k, y0 + Hh + 3 * k + 62, ACC, 3)
    d.text(x0 + 48 * k + 14, y0 + Hh + 3 * k + 52, "pull out by the grip", 13, MUTE)
    X = 410
    d.note(X, 96, "Window L  ·  18 × 12 mm", "phone macro mode, or coarse material (> 1 mm)")
    d.note(X, 146, "Window S  ·  6 × 4 mm", "clip-on macro lens")
    d.note(X, 200, "Sprinkle thinly, then tap the tray", "particles mostly not touching, about 10–20 % covered")
    # good / bad insets
    for (xx, lab, n, col, sd) in [(X, "Good", 34, GOOD, 5), (X + 172, "Too dense", 190, BAD, 9)]:
        d.rect(xx, 248, 156, 104, "#fbfcfc", col, 2, 4)
        particles(d, xx + 4, 252, 148, 96, n, 2.2, 8.5, sd)
        d.text(xx + 78, 372, lab, 14, col, "middle", "700")
    d.text(X, 398, ["Keep particles inside the dashed window: any that", "touch its edge are ignored. Dots and sample face up."], 13, MUTE)
    d.save("step2_load")


# ---------------------------------------------------------------- section view helper (side cut, front at left)
def section(d, X0, G, k, tray_off=0.0, phone=True):
    sx = lambda y: X0 + k * y
    sy = lambda z: G - k * z
    R = lambda y0, y1, z0, z1, fill, sw=1.4: d.rect(sx(y0), sy(z1), (y1 - y0) * k, (z1 - z0) * k, fill, INK, sw)
    d.line(sx(-75), G, sx(160), G, LINE, 1.5)
    # base body (white)
    R(0, 110, 0, 2, WHITE_P); R(0, 3, 2, 24, WHITE_P)
    R(107, 110, 2, 5, WHITE_P); R(107, 110, 22, 31.6, WHITE_P)
    d.poly([(sx(3), sy(2)), (sx(3), sy(14)), (sx(99), sy(2))], WHITE_P)
    # lid (black)
    R(0, 27, 31.6, 35.6, BLACK_P); R(83, 110, 31.6, 35.6, BLACK_P)
    R(23, 27, 35.6, 47, BLACK_P); R(83, 87, 35.6, 47, BLACK_P)
    R(25, 27, 47, 49, BLACK_P); R(83, 85, 47, 49, BLACK_P)
    # deck
    R(0, 25, 47, 52, DECK); R(85, 110, 47, 52, DECK); R(25, 30, 49, 52, DECK); R(80, 85, 49, 52, DECK)
    # tray
    o = tray_off
    R(o + 0, o + 92, 30, 31, "#ffffff", 1.6)
    R(o + 0, o + 3, 24, 30, "#ffffff"); R(o + 89, o + 92, 24, 30, "#ffffff")
    R(o - 3, o + 0, 22, 31, "#e3e7ea"); R(o - 9, o - 3, 22, 31, "#e3e7ea")
    for yy in range(35, 77, 4):                                            # dots seen edge-on
        if 49 <= yy <= 61: continue
        d.rect(sx(o + yy) - 1.5, sy(31) - 0.2, 3, k * 1 + 0.4, INK, "none", 0)
    for yy in (51, 53.5, 56, 58.5):                                        # particles on the window
        d.circle(sx(o + yy), sy(31) - 2.2, 2.2, "#30363b", "none")
    if phone:
        d.rect(sx(16), sy(60), 78 * k, 8 * k, PHONE, INK, 1.5, 7)
        d.rect(sx(50), sy(52), 10 * k, 2 * k, "#6b747b", INK, 1.2, 1)
        d.text(sx(55), sy(60) - 8, "phone (screen up)", 12.5, MUTE, "middle")
    return sx, sy


# ---------------------------------------------------------------- 3 slide in
def d_slide():
    d = D("3", "Slide the drawer back in")
    sx, sy = section(d, 235, 372, 3.0, tray_off=-48)
    d.arrow(sx(-74), sy(26.5), sx(-59), sy(26.5), ACC, 4)
    d.add(f'<path d="M{sx(-48+92):.1f},{sy(30.5):.1f} H{sx(106):.1f}" stroke="{ACC}" stroke-width="1.5" stroke-dasharray="5 4" fill="none"/>')
    d.note(40, 96, "Push until the face plate meets the base", "The windows then sit under the middle of the tunnel.")
    d.text(sx(-40), sy(0) + 22, "FRONT", 12, MUTE, "middle", "700")
    d.text(sx(125), sy(0) + 22, "BACK", 12, MUTE, "middle", "700")
    d.leader(sx(-30), sy(31), sx(-30), sy(40)); d.text(sx(-30), sy(40) - 6, "sample + dots face up", 12.5, MUTE, "middle")
    d.leader(sx(85), sy(41), sx(128), sy(46)); d.text(sx(130), sy(46) + 4, "light tunnel (black)", 12.5, MUTE)
    d.leader(sx(60), sy(10), sx(128), sy(26)); d.text(sx(130), sy(26) + 4, "white light chamber", 12.5, MUTE)
    d.text(sx(55), 148, "cut-away side view", 12, MUTE, "middle")
    d.save("step3_slide_in")


# ---------------------------------------------------------------- 4 light
def d_light():
    d = D("4", "Light it from below, through a port")
    X0, G, k = 150, 372, 3.0
    sx = lambda y: X0 + k * y
    sy = lambda z: G - k * z
    # glow in the chamber, drawn under the section
    d.poly([(sx(3), sy(14)), (sx(99), sy(2)), (sx(107), sy(2)), (sx(107), sy(24)), (sx(3), sy(24))], "#fff3c4", "none", 0)
    d.poly([(sx(34), sy(31)), (sx(76), sy(31)), (sx(60), sy(50)), (sx(50), sy(50))], "#fff8dd", "none", 0)
    section(d, X0, G, k, 0)
    # sun + rays
    d.circle(sx(150), sy(46), 17, SUN, "none")
    for a in range(0, 360, 45):
        d.line(sx(150) + 23 * math.cos(math.radians(a)), sy(46) + 23 * math.sin(math.radians(a)), sx(150) + 31 * math.cos(math.radians(a)), sy(46) + 31 * math.sin(math.radians(a)), SUN, 2.5, 'stroke-linecap="round"')
    for (z_in, yr) in [(19, 82), (13, 60), (8, 40)]:
        zr = 14 - 12 * (yr - 3) / 96
        d.line(sx(143), sy(z_in + 22), sx(108.5), sy(z_in), SUN, 2.5, 'stroke-linecap="round"')
        d.line(sx(108.5), sy(z_in), sx(yr), sy(zr), SUN, 2.5, 'stroke-linecap="round"')
        d.arrow(sx(yr), sy(zr), sx(yr - 6 if yr > 55 else yr + 6), sy(29), SUN, 2.5)
    d.arrow(sx(55), sy(33), sx(55), sy(49.5), SUN, 2.5)
    d.leader(sx(108.5), sy(6.5), sx(104), G + 20); d.text(sx(104), G + 36, "light port (back wall; there is another on the left side)", 12.5, MUTE, "middle")
    d.note(40, 92, "Outdoors: aim a port at open sky or the sun", None)
    d.note(40, 114, "Indoors: shine a phone torch or desk lamp into a port", None)
    d.text(40, 138, "The white chamber spreads the light; the tray glows and particles show as dark silhouettes.", 13, MUTE)
    d.text(40, 156, "The phone and tunnel block light from above. Keep the port out of shadow.", 13, MUTE)
    d.save("step4_light")


# ---------------------------------------------------------------- 5 place phone (top view)
def d_phone():
    d = D("5", "Lay the phone on the deck, lens over the window", h=450)
    k, x0, y0 = 2.25, 60, 128
    U = lambda u: x0 + u * k
    V = lambda v: y0 + (110 - v) * k                   # v measured from the front edge
    d.rect(U(0), V(110), 200 * k, 110 * k, DECK, INK, 1.8, 13)
    d.rect(U(62), V(80), 76 * k, 50 * k, "#ffffff", INK, 1.5, 6)
    lattice(d, U(100), V(55), k, clip=(U(62) + 2, V(80) + 2, U(138) - 2, V(30) - 2))
    for nm, (a, b, c, e) in ROIS.items():
        d.rect(U(100 + a), V(55 + e), (b - a) * k, (e - c) * k, "none", ACC, 1.3, 1, 'stroke-dasharray="4 3"')
    # engraved grooves
    d.line(U(0), V(55), U(62), V(55), INK, 1); d.line(U(138), V(55), U(200), V(55), INK, 1)
    for u, nm in ((88, "L"), (114, "S")):
        d.line(U(u), V(110), U(u), V(80), INK, 1); d.line(U(u), V(30), U(u), V(0), INK, 1)
        d.text(U(u) + 6, V(110) + 16, nm, 13, INK, "start", "700")
    # phone: camera at (88,55), 20 mm in from the end and from the far long edge
    d.rect(U(68), V(75), 163 * k, 78 * k, "#8e979d", INK, 2, 16, 'fill-opacity="0.33"')
    d.circle(U(88), V(55), 7 * k, "none", INK, 1.6, 'stroke-dasharray="4 3"')
    d.line(U(88) - 22, V(55), U(88) + 22, V(55), BAD, 1.6); d.line(U(88), V(55) - 22, U(88), V(55) + 22, BAD, 1.6)
    d.text(U(185), V(36), "phone, screen up", 13, INK, "middle", "650")
    d.leader(U(88) - 5 * k, V(55) + 5 * k, U(42), V(84)); d.text(U(8), V(90), "lens (underneath)", 12.5, INK)
    d.text(U(100), V(0) + 20, "FRONT (drawer side)", 12, MUTE, "middle", "700")
    d.text(60, 84, "Slide the phone until the lens you are using sits where the L (or S) groove crosses the centre groove.", 13.5, INK)
    d.text(60, 102, "Clip-on lens: Camera at 1×. Pro phones: macro mode. It need not be exact; the app finds the window.", 12.5, MUTE)
    d.save("step5_place_phone")


# ---------------------------------------------------------------- phone UI mock helper
def mock(d, x, y, w=214, h=372, title="Particle Field"):
    d.rect(x, y, w, h, "#111417", INK, 2, 24)
    sx, sy, sw, sh = x + 8, y + 10, w - 16, h - 20
    d.add(f'<clipPath id="c{int(x)}"><rect x="{sx}" y="{sy}" width="{sw}" height="{sh}" rx="16"/></clipPath>')
    d.rect(sx, sy, sw, sh, "#f4f6f7", "none", 0, 16)
    if title:
        d.add(f'<rect x="{sx}" y="{sy}" width="{sw}" height="34" fill="{ACC}" clip-path="url(#c{int(x)})"/>')
        d.text(sx + 12, sy + 23, title, 13, "#fff", "start", "650")
    return sx, sy, sw, sh

def bullet(d, x, y, col, head, body):
    d.circle(x + 7, y - 5, 7, col, "none")
    d.text(x + 24, y, head, 14.5, INK, "start", "650")
    d.text(x + 24, y + 19, body, 13, MUTE)


# ---------------------------------------------------------------- 6 align
def d_align():
    d = D("6", "Open the app → Align camera (live check)", h=470)
    sx, sy, sw, sh = mock(d, 44, 80, title=None)
    d.rect(sx, sy, sw, sh, "#000", "none", 0, 16)
    ix, iy, iw, ih = sx + 4, sy + 46, sw - 8, (sw - 8) * 0.75
    d.rect(ix, iy, iw, ih, "#dfe3e5", "none", 0)
    k = 6.6; cx, cy = ix + iw / 2 + 12 * k, iy + ih / 2          # window L centred in view
    lattice(d, cx, cy, k, clip=(ix + 4, iy + 4, ix + iw - 4, iy + ih - 4), col="#22282c")
    a, b, c, e = ROIS["L"]
    particles(d, cx + a * k + 4, cy - e * k + 4, (b - a) * k - 8, (e - c) * k - 8, 40, 0.8, 3.2, 4)
    d.rect(cx + a * k, cy - e * k, (b - a) * k, (e - c) * k, "none", "#ffd400", 2.5)
    mx, my = ix + iw / 2, iy + ih / 2
    d.line(mx - 12, my, mx + 12, my, "#ffffff", 1.2); d.line(mx, my - 12, mx, my + 12, "#ffffff", 1.2)
    d.rect(sx + sw - 54, sy + 10, 44, 22, "#e9edef", "none", 0, 7); d.text(sx + sw - 32, sy + 25, "Done", 11.5, INK, "middle", "650")
    hy = iy + ih + 16
    d.rect(sx + 6, hy, sw - 12, 104, "#2a2f33", "none", 0, 10)
    d.text(sx + 14, hy + 20, ["Window L found · 96 dots", "field ≈ 31 mm wide", "≈ 7.7 µm/px → 200 µm ≈ 26 px"], 11, "#fff")
    d.text(sx + 14, hy + 66, "resolution OK", 11.5, "#4fd1a5", "start", "700")
    d.text(sx + 14, hy + 84, "Sharpness: sharp", 11, "#fff")
    d.text(sx + sw / 2, sy + sh - 10, "example values", 10, "#8a949b", "middle")
    X = 300
    d.text(X, 96, "Read the panel at the bottom, then adjust:", 14.5, INK, "start", "650")
    bullet(d, X, 136, GOOD, "resolution OK  +  sharp", "Go to step 7.")
    bullet(d, X, 190, WARN, "marginal", "Usable. Closer (fewer spacers) or window S + clip-on lens is better.")
    bullet(d, X, 244, BAD, "too coarse", "Move closer, or use window S with a clip-on macro lens.")
    bullet(d, X, 298, "#7a8790", "soft – tap to focus", "Tap the tray on screen. Never sharp? Add a spacer (lens too close).")
    bullet(d, X, 352, "#7a8790", "Looking for the dot grid…", "Slide the phone until a window is in view; check the light.")
    d.text(X, 404, ["The yellow box is the area that will be measured.", "The preview is coarser than the photo, so judge by the numbers."], 13, MUTE)
    d.save("step6_align")


# ---------------------------------------------------------------- 7 shoot + check
def d_shoot():
    d = D("7", "Take the photo and check its badge", h=470)
    sx, sy, sw, sh = mock(d, 44, 80)
    d.text(sx + 12, sy + 58, "Photos", 12.5, INK, "start", "650")
    rows = [("IMG_0412", "Window L · 7.74 µm/px · 138 counted", "Good", GOOD),
            ("IMG_0413", "Window L · 7.71 µm/px · 151 counted", "Good", GOOD),
            ("IMG_0414", "Window L · 7.80 µm/px · 97 counted", "Check", WARN),
            ("IMG_0415", "No calibration dots found.", "No result", BAD)]
    for r, (nm, ln, bd, col) in enumerate(rows):
        yy = sy + 72 + r * 56
        d.rect(sx + 8, yy, sw - 16, 48, "#ffffff", "#d9e0e4", 1, 8)
        d.rect(sx + 14, yy + 8, 40, 32, "#dfe3e5", "none", 0, 4)
        for q in range(6): d.circle(sx + 20 + (q % 3) * 14, yy + 17 + (q // 3) * 14, 2.2, "#22282c", "none")
        d.text(sx + 60, yy + 20, nm, 10.5, INK, "start", "650")
        d.text(sx + 60, yy + 35, ln[:27] + ("…" if len(ln) > 27 else ""), 8.3, MUTE)
        bw = 8 + len(bd) * 5.6
        d.rect(sx + sw - 14 - bw, yy + 6, bw, 15, col, "none", 0, 7); d.text(sx + sw - 14 - bw / 2, yy + 17, bd, 9, "#fff", "middle", "700")
    d.rect(sx + 8, sy + sh - 44, sw - 16, 36, "#ffffff", "#d9e0e4", 1, 8)
    for q, t in enumerate(("Capture", "Photos (4)", "Results")):
        d.text(sx + 8 + (sw - 16) * (q + 0.5) / 3, sy + sh - 22, t, 10, ACC if q == 1 else MUTE, "middle", "650" if q == 1 else "400")
    d.text(sx + sw / 2, sy + sh - 52, "example", 10, "#8a949b", "middle")
    X = 300
    d.note(X, 96, "Capture → Take photo", "Tap the window to focus, hold still, shoot. Every photo calibrates itself.")
    d.text(X, 158, "Then look at Photos:", 14.5, INK, "start", "650")
    bullet(d, X, 196, GOOD, "Good", "≥ 20 px across 200 µm, sharp, clean grid fit. Keep it.")
    bullet(d, X, 248, WARN, "Check", "Soft or a little coarse. Tap it to see why; retake if you can.")
    bullet(d, X, 300, BAD, "Too coarse / No result", "Not usable. Remove it (X button) and fix the setup (step 6).")
    d.text(X, 362, ["Tap any photo to see what was measured:", "teal outline = counted · grey = cut by the window edge", "orange = below the minimum size"], 13, MUTE)
    d.save("step7_shoot_check")


# ---------------------------------------------------------------- 8 results
def d_results():
    d = D("8", "Repeat for 500+ particles, then read and export", h=470)
    sx, sy, sw, sh = mock(d, 44, 80)
    d.rect(sx + 8, sy + 44, 110, 20, "#e6ebee", "none", 0, 7)
    d.rect(sx + 10, sy + 46, 52, 16, "#ffffff", "none", 0, 6); d.text(sx + 36, sy + 58, "By count", 8.5, INK, "middle", "650")
    d.text(sx + 90, sy + 58, "By volume", 8.5, MUTE, "middle")
    d.text(sx + sw - 10, sy + 58, "612 particles", 8.5, MUTE, "end")
    for q, (kk, vv) in enumerate((("D10", "148"), ("D50", "236"), ("D90", "410"))):
        xx = sx + 8 + q * ((sw - 16) / 3)
        d.rect(xx + 2, sy + 72, (sw - 16) / 3 - 4, 44, "#e9eef1", "none", 0, 8)
        d.text(xx + 10, sy + 87, kk, 9, MUTE); d.text(xx + 10, sy + 105, vv, 15, INK, "start", "700"); d.text(xx + 40, sy + 105, "µm", 8, MUTE)
    d.rect(sx + 8, sy + 124, sw - 16, 112, "#ffffff", "#d9e0e4", 1, 8)
    bars = [4, 9, 19, 27, 21, 11, 6, 3]
    for q, b in enumerate(bars):
        d.rect(sx + 22 + q * 20.5, sy + 222 - b * 3, 17, b * 3, ACC, "none", 0, 2)
    d.line(sx + 18, sy + 222, sx + sw - 18, sy + 222, LINE, 1)
    d.text(sx + sw / 2, sy + 233, "size (µm)", 8, MUTE, "middle")
    d.text(sx + 16, sy + 139, "Share of count per size class", 9, INK, "start", "650")
    for q, t in enumerate(("Particles CSV", "Size classes CSV", "Save to history")):
        yy = sy + 246 + q * 26
        d.rect(sx + 8, yy, sw - 16, 21, "#e9eef1", "#d9e0e4", 1, 7); d.text(sx + sw / 2, yy + 14.5, t, 9.5, INK, "middle", "650")
    d.text(sx + sw / 2, sy + sh - 10, "example values", 10, "#8a949b", "middle")
    X = 300
    d.note(X, 96, "Repeat steps 2–7 with fresh sub-samples", "until Results shows 500+ particles. D10/D50/D90 settle around there.")
    # loop arrow
    d.add(f'<path d="M{X+8},150 h236 a16,16 0 0 1 16,16 v10 a16,16 0 0 1 -16,16 h-228" fill="none" stroke="{ACC}" stroke-width="2.5"/>')
    d.arrow(X + 20, 192, X + 4, 192, ACC, 2.5)
    d.text(X + 126, 176, "new sub-sample → photo → check", 12.5, ACC, "middle", "650")
    d.note(X, 250, "By count / By volume", "Volume weighting compares best with sieve or laser results.")
    d.note(X, 304, "Export", "Either CSV button opens the share sheet (Files, Mail, AirDrop).")
    d.note(X, 358, "Save to history", "Keeps the sample name, location and D-values on the phone.")
    d.text(X, 418, "Empty the tray and wipe it with a dry brush before the next sample.", 13, MUTE)
    d.save("step8_results")


if __name__ == "__main__":
    for f in (d_pitch, d_assemble, d_load, d_slide, d_light, d_phone, d_align, d_shoot, d_results): f()
