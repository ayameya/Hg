from pathlib import Path

import cadquery as cq

W = 12.8
D = 12.8
H = 6.5
T = 0.3

HOUSING_D = 4.2
TONGUE_D = 6.0
CHANNEL_W = 3.7
CHANNEL_Z = 0.6
LOBE_R = 0.8

WIN_X_IN = 3.8
WIN_X_OUT = 0.25
WIN_Y0 = 2.9
WIN_Y1 = 5.6
WIN_DEPTH = 1.0

PIN_PITCH = 2.0
PIN_ROWS_FROM_REAR = (0.6, 2.6)
PIN_SIZE = 0.4
PIN_LEN = 2.8
SLOT_W = 1.0
SLOT_D = 3.2
SLOT_Z = 1.2

LEG_FROM_REAR = (2.9, 8.4)
LEG_W = 1.4
LEG_LEN = 3.0

OUT = Path(__file__).resolve().parent


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def make_shell():
    yf = D - HOUSING_D
    lobe_w = (W - CHANNEL_W) / 2
    lobes = None
    for sx in (-1, 1):
        x0 = sx * CHANNEL_W / 2 if sx > 0 else -W / 2
        lobe = box(x0, x0 + lobe_w, 0, yf, 0, H).edges("|Y and <Z").fillet(LOBE_R)
        lobes = lobe if lobes is None else lobes.union(lobe)
    strip = box(-CHANNEL_W / 2, CHANNEL_W / 2, 0, yf, CHANNEL_Z, H)
    walls = (
        box(-W / 2, -W / 2 + T, yf, D, 0, H)
        .union(box(W / 2 - T, W / 2, yf, D, 0, H))
        .union(box(-W / 2, W / 2, yf, D, H - T, H))
    )
    shell = lobes.union(strip).union(walls)
    for sx in (-1, 1):
        xa, xb = sorted((sx * (W / 2 - WIN_X_OUT), sx * (W / 2 - WIN_X_IN)))
        shell = shell.cut(box(xa, xb, WIN_Y0, WIN_Y1, -0.1, WIN_DEPTH))
    for y in LEG_FROM_REAR:
        yc = D - y
        for sx in (-1, 1):
            xa, xb = sorted((sx * W / 2, sx * (W / 2 - T)))
            leg = box(xa, xb, yc - LEG_W / 2, yc + LEG_W / 2, -LEG_LEN, 0.01)
            leg = leg.edges("|X and <Z").chamfer(0.3)
            shell = shell.union(leg)
    return shell


def make_housing():
    yf = D - HOUSING_D
    body = box(-W / 2 + T, W / 2 - T, yf, D, 0, H - T)
    tongue = box(-CHANNEL_W / 2, CHANNEL_W / 2, D - TONGUE_D, yf + 0.01, 0, CHANNEL_Z + 0.01)
    body = body.union(tongue)
    for i in (-1, 0, 1):
        x = i * PIN_PITCH
        body = body.cut(box(x - SLOT_W / 2, x + SLOT_W / 2, D - SLOT_D, D + 0.1, -0.1, SLOT_Z))
    return body


def make_pins():
    pins = None
    for i in (-1, 0, 1):
        for r in PIN_ROWS_FROM_REAR:
            x, y = i * PIN_PITCH, D - r
            p = box(x - PIN_SIZE / 2, x + PIN_SIZE / 2, y - PIN_SIZE / 2, y + PIN_SIZE / 2, -PIN_LEN, SLOT_Z + 0.01)
            p = p.faces("<Z").edges().chamfer(0.1)
            pins = p if pins is None else pins.union(p)
    return pins


def build():
    shell = make_shell()
    housing = make_housing()
    pins = make_pins()
    asm = cq.Assembly(name="connector")
    asm.add(shell, name="shell", color=cq.Color(0.80, 0.74, 0.52))
    asm.add(housing, name="housing", color=cq.Color(0.08, 0.08, 0.08))
    asm.add(pins, name="pins", color=cq.Color(0.90, 0.70, 0.30))
    return asm, shell.union(housing).union(pins)


if __name__ == "__main__":
    asm, solid = build()
    asm.export(str(OUT / "connector.step"))
    cq.exporters.export(solid, str(OUT / "connector.stl"), tolerance=0.01, angularTolerance=0.1)
    bb = solid.val().BoundingBox()
    print(f"bbox X {bb.xmin:.2f}..{bb.xmax:.2f}  Y {bb.ymin:.2f}..{bb.ymax:.2f}  Z {bb.zmin:.2f}..{bb.zmax:.2f}")
