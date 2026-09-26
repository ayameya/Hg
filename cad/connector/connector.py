from pathlib import Path

import cadquery as cq

W = 12.8
D = 12.8
H = 7.8
T = 0.3

R_TOP = 0.9
R_BOT = 0.4
R_CH = 0.4
CH_W_BOT = 4.5
CH_W_TOP = 3.2
CH_H = 1.3

CAVITY_D = 8.6
FLOOR_Z = 1.0

BWIN_X_IN = 3.8
BWIN_X_OUT = 0.25
BWIN_Y = (2.9, 5.6)

TONGUE_Y0 = 6.8

FINGER_SLOT_X = (2.45, 4.95)
FINGER_SLOT_Y = (0.7, 7.6)
FINGER_X = 3.7
FINGER_W = 1.35
FINGER_DIP = 0.5

DOGBONE_X = (2.1, 4.6)
DOGBONE_Y = 8.95
DOGBONE_W = 0.7

REAR_NOTCH_X = 3.2
REAR_NOTCH_W = 1.5
REAR_NOTCH_D = 0.8

FLANGE_OUT = 0.7
FLANGE_Z = (1.1, 6.2)

SIDE_WIN_Y = (2.8, 5.8)
SIDE_WIN_Z = (2.0, 5.3)
SIDE_HOLES = ((10.4, 10.9, 5.6, 6.3), (10.4, 10.9, 4.4, 5.0))

BAR_HALF_W = 3.1
BAR_Z = (3.8, 5.3)
BAR_Y0 = 5.0
FRAME_Z1 = 7.0
FRAME_Y0 = 7.2
CONTACT_SLOT_W = 0.9
CONTACT_W = 0.4
CONTACT_H = 0.6
CONTACT_Y0 = 5.6

PIN_PITCH = 2.0
PIN_ROW_FRONT = 10.2
PIN_ROW_REAR = 12.2
PIN_SIZE = 0.4
PIN_LEN = 2.8
PIN_EXIT_Z = 4.7
SLOT_W = 1.0
SLOT_D = 3.2
SLOT_Z = 1.2
GROOVE_D = 1.0

LEG_Y = (4.4, 9.9)
LEG_W = 1.4
LEG_LEN = 2.8

OUT = Path(__file__).resolve().parent


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def along_y(face, y0, y1):
    solid = cq.Solid.extrudeLinear(face, cq.Vector(0, y1 - y0, 0))
    bb = solid.BoundingBox()
    return cq.Workplane("XY").add(solid.translate(cq.Vector(0, y0 - bb.ymin, 0)))


def outer_profile():
    pts = [
        (-W / 2, 0), (-CH_W_BOT / 2, 0), (-CH_W_TOP / 2, CH_H), (CH_W_TOP / 2, CH_H),
        (CH_W_BOT / 2, 0), (W / 2, 0), (W / 2, H), (-W / 2, H),
    ]
    solid = cq.Workplane("XZ").polyline(pts).close().extrude(1)
    solid = solid.edges("|Y and >Z").fillet(R_TOP)
    solid = solid.edges("|Y and <Z").fillet(R_BOT)
    solid = solid.edges("|Y").edges(cq.selectors.BoxSelector((-CH_W_BOT, -5, 0.1), (CH_W_BOT, 5, CH_H + 0.1))).fillet(R_CH)
    face = solid.faces("<Y").val()
    return cq.Face.makeFromWires(face.outerWire())


def inner_profile(outer):
    wire = outer.outerWire().offset2D(-T)[0]
    return cq.Face.makeFromWires(wire)


def make_shell(outer, inner):
    shell = along_y(outer, 0, D).cut(along_y(inner, -0.1, D + 0.1))
    shell = shell.cut(box(-W / 2 + T, W / 2 - T, CAVITY_D, D + 0.1, -0.1, CH_H + T + 0.05))
    floor = along_y(inner, 0, CAVITY_D).intersect(box(-W, W, -1, CAVITY_D, -1, FLOOR_Z))
    shell = shell.union(floor)

    for sx in (-1, 1):
        xa, xb = sorted((sx * (W / 2 - BWIN_X_OUT), sx * (W / 2 - BWIN_X_IN)))
        shell = shell.cut(box(xa, xb, BWIN_Y[0], BWIN_Y[1], -0.1, FLOOR_Z + 0.05))

        xa, xb = sorted((sx * FINGER_SLOT_X[0], sx * FINGER_SLOT_X[1]))
        shell = shell.cut(box(xa, xb, FINGER_SLOT_Y[0], FINGER_SLOT_Y[1], H - 1.5, H + 0.1))
        fx = sx * FINGER_X
        finger = box(fx - FINGER_W / 2, fx + FINGER_W / 2, FINGER_SLOT_Y[0] + 0.2, FINGER_SLOT_Y[1] + 0.01, H - T, H)
        dip = box(fx - FINGER_W / 2, fx + FINGER_W / 2, FINGER_SLOT_Y[0] + 0.3, FINGER_SLOT_Y[0] + 1.1, H - T - FINGER_DIP, H - T)
        shell = shell.union(finger).union(dip.edges("|X").fillet(0.2))

        dx = sx * (DOGBONE_X[0] + DOGBONE_X[1]) / 2
        dog = (
            cq.Workplane("XY").workplane(offset=H - 1)
            .center(dx, DOGBONE_Y).slot2D(DOGBONE_X[1] - DOGBONE_X[0], DOGBONE_W).extrude(1.2)
        )
        shell = shell.cut(dog)

        nx = sx * REAR_NOTCH_X
        shell = shell.cut(box(nx - REAR_NOTCH_W / 2, nx + REAR_NOTCH_W / 2, D - REAR_NOTCH_D, D + 0.1, H - 1, H + 0.1))

        xa, xb = sorted((sx * (W / 2 + 0.1), sx * (W / 2 - 1)))
        shell = shell.cut(box(xa, xb, SIDE_WIN_Y[0], SIDE_WIN_Y[1], SIDE_WIN_Z[0], SIDE_WIN_Z[1]))
        for y0, y1, z0, z1 in SIDE_HOLES:
            shell = shell.cut(box(xa, xb, y0, y1, z0, z1))

        xa, xb = sorted((sx * (W / 2 - 0.01), sx * (W / 2 + FLANGE_OUT)))
        flange = box(xa, xb, 0, T, FLANGE_Z[0], FLANGE_Z[1])
        shell = shell.union(flange.edges("|Y").fillet(0.1))

        for y in LEG_Y:
            xa, xb = sorted((sx * W / 2, sx * (W / 2 - T)))
            leg = box(xa, xb, y - LEG_W / 2, y + LEG_W / 2, -LEG_LEN, R_BOT + 0.2)
            shell = shell.union(leg.edges("|X and <Z").chamfer(0.3))
    return shell


def make_housing(outer):
    body = along_y(outer, CAVITY_D, D).intersect(box(-W / 2 + T, W / 2 - T, 0, D + 1, 0, H - T))
    for sx in (-1, 1):
        nx = sx * REAR_NOTCH_X
        body = body.union(box(nx - REAR_NOTCH_W / 2 + 0.1, nx + REAR_NOTCH_W / 2 - 0.1, D - REAR_NOTCH_D, D, H - T - 0.01, H))
    tongue = box(-CH_W_TOP / 2, CH_W_TOP / 2, TONGUE_Y0, CAVITY_D + 0.01, 0.2, CH_H)
    bar = box(-BAR_HALF_W, BAR_HALF_W, BAR_Y0, CAVITY_D + 0.01, BAR_Z[0], BAR_Z[1])
    frame = box(-BAR_HALF_W, BAR_HALF_W, FRAME_Y0, CAVITY_D + 0.01, BAR_Z[1] - 0.01, FRAME_Z1)
    body = body.union(tongue).union(bar.edges("|Y or |X").fillet(0.2)).union(frame)
    for i in (-1, 0, 1):
        x = i * PIN_PITCH
        body = body.cut(box(x - CONTACT_SLOT_W / 2, x + CONTACT_SLOT_W / 2, FRAME_Y0 - 0.1, CAVITY_D + 0.9, BAR_Z[1], FRAME_Z1 - 0.2))
        body = body.cut(box(x - SLOT_W / 2, x + SLOT_W / 2, D - SLOT_D, D + 0.1, -0.1, SLOT_Z))
        body = body.cut(box(x - SLOT_W / 2, x + SLOT_W / 2, D - GROOVE_D, D + 0.1, -0.1, PIN_EXIT_Z + 0.2))
    return body


def make_contacts():
    parts = None
    for i in (-1, 0, 1):
        x = i * PIN_PITCH
        c = box(x - CONTACT_W / 2, x + CONTACT_W / 2, CONTACT_Y0, CAVITY_D + 0.5, BAR_Z[1], BAR_Z[1] + 0.15)
        bump = box(x - CONTACT_W / 2, x + CONTACT_W / 2, CONTACT_Y0 + 0.4, CONTACT_Y0 + 1.2, BAR_Z[1], BAR_Z[1] + CONTACT_H)
        c = c.union(bump.edges("|X").fillet(0.15))
        pf = box(x - PIN_SIZE / 2, x + PIN_SIZE / 2, PIN_ROW_FRONT - PIN_SIZE / 2, PIN_ROW_FRONT + PIN_SIZE / 2, -PIN_LEN, SLOT_Z + 0.01)
        pr = box(x - PIN_SIZE / 2, x + PIN_SIZE / 2, PIN_ROW_REAR - PIN_SIZE / 2, PIN_ROW_REAR + PIN_SIZE / 2, -PIN_LEN, PIN_EXIT_Z + PIN_SIZE / 2)
        stub = box(x - PIN_SIZE / 2, x + PIN_SIZE / 2, D - GROOVE_D - 0.01, PIN_ROW_REAR + PIN_SIZE / 2, PIN_EXIT_Z - PIN_SIZE / 2, PIN_EXIT_Z + PIN_SIZE / 2)
        for p in (pf, pr):
            c = c.union(p.faces("<Z").edges().chamfer(0.1))
        c = c.union(stub)
        parts = c if parts is None else parts.union(c)
    return parts


def build():
    outer = outer_profile()
    inner = inner_profile(outer)
    shell = make_shell(outer, inner)
    housing = make_housing(outer)
    contacts = make_contacts()
    asm = cq.Assembly(name="connector")
    asm.add(shell, name="shell", color=cq.Color(0.80, 0.78, 0.70))
    asm.add(housing, name="housing", color=cq.Color(0.08, 0.08, 0.08))
    asm.add(contacts, name="contacts", color=cq.Color(0.90, 0.70, 0.30))
    return asm, shell, housing, contacts


if __name__ == "__main__":
    asm, shell, housing, contacts = build()
    asm.export(str(OUT / "connector.step"))
    solid = shell.union(housing).union(contacts)
    cq.exporters.export(solid, str(OUT / "connector.stl"), tolerance=0.01, angularTolerance=0.1)
    bb = solid.val().BoundingBox()
    print(f"bbox X {bb.xmin:.2f}..{bb.xmax:.2f}  Y {bb.ymin:.2f}..{bb.ymax:.2f}  Z {bb.zmin:.2f}..{bb.zmax:.2f}")
    for n, p in (("shell", shell), ("housing", housing), ("contacts", contacts)):
        print(n, len(p.solids().vals()), p.val().isValid())
