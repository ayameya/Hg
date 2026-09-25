import pathlib
import schemdraw
import schemdraw.elements as elm
import schemdraw.logic as logic
import schemdraw.flow as flow

OUT = pathlib.Path(__file__).resolve().parent.parent / "figures"
OUT.mkdir(exist_ok=True)
schemdraw.use("svg")
schemdraw.config(font="IPAGothic, sans-serif", fontsize=11, lw=1.3, margin=0.6)


def W(a, b):
    return elm.Line().endpoints(a, b)


def T(xy, text, **kw):
    kw.setdefault("halign", "left")
    kw.setdefault("valign", "center")
    kw.setdefault("fontsize", 10)
    return elm.Label().at(xy).label(text, **kw)


def gnd(xy):
    return elm.Ground().at(xy)


def vdd(xy, name):
    return elm.Vdd().at(xy).label(name)


def optical():
    with schemdraw.Drawing(file=str(OUT / "optical_io.svg"), show=False) as d:
        T((0, 8.6), "送信部 (TX)", fontsize=13)
        elm.Dot(open=True).at((0, 3))
        T((-0.25, 3), "PA12\nFDCAN1_TX", halign="right")
        W((0, 3), (1.5, 3))
        elm.Dot().at((1.5, 3))
        elm.Resistor().endpoints((1.5, 3), (1.5, 5.2))
        T((1.8, 4.1), "R56\n10k")
        vdd((1.5, 5.2), "+3V3")
        W((1.5, 3), (2.4, 3))
        inv = logic.Not().theta(0).at((2.4, 3)).anchor("in1")
        T((2.6, 3.9), "U4 74LVC1G04", fontsize=9)
        gx = inv.out[0] + 2.2
        elm.Resistor().endpoints(inv.out, (gx, 3))
        T((inv.out[0] + 0.5, 3.6), "R57 22Ω")
        elm.Dot().at((gx, 3))
        elm.Resistor().endpoints((gx, 3), (gx, 0.9))
        T((gx - 0.3, 1.95), "R60\n100k", halign="right")
        gnd((gx, 0.9))
        q = elm.NFet(bulk=False).theta(0).reverse().at((gx + 1.0, 3)).anchor("gate")
        W((gx, 3), (gx + 1.0, 3))
        T((q.drain[0] + 0.4, 3.0), "Q18\n2N7002")
        W(q.source, (q.source[0], q.source[1] - 0.4))
        gnd((q.source[0], q.source[1] - 0.4))
        xd = q.drain[0]
        elm.LED().endpoints((xd, q.drain[1]), (xd, q.drain[1] + 2.2)).reverse()
        T((xd + 0.4, q.drain[1] + 1.1), "D9  TSHF5210\n890nm 赤外LED")
        elm.Resistor().endpoints((xd, q.drain[1] + 2.2), (xd, q.drain[1] + 4.4))
        T((xd + 0.4, q.drain[1] + 3.3), "R58 33Ω\n(R59 33Ω 並列: DNP)")
        vdd((xd, q.drain[1] + 4.4), "+3V3")
        T((xd + 3.4, q.drain[1] + 1.1), "TXD=0 (ドミナント)\n→ 発光", fontsize=10)

        y = -1.0
        T((0, y + 0.4), "受信部 (RX) と自局ループバック", fontsize=13)
        x0 = 0.8
        vdd((x0, y - 0.6), "+3V3")
        elm.Resistor().endpoints((x0, y - 0.6), (x0, y - 2.4))
        T((x0 - 0.3, y - 1.5), "R61\n100Ω", halign="right")
        elm.Dot().at((x0, y - 2.4))
        elm.Capacitor().endpoints((x0, y - 2.4), (x0 + 1.8, y - 2.4))
        T((x0 + 0.5, y - 1.8), "C35 1µF")
        gnd((x0 + 1.8, y - 2.4))
        ypd = y - 5.0
        elm.Photodiode().endpoints((x0, y - 2.4), (x0, ypd)).reverse()
        T((x0 - 0.5, y - 3.7), "D10\nBPV10NF", halign="right")
        elm.Dot().at((x0, ypd))
        T((x0 - 0.3, ypd + 0.3), "PD_OUT", halign="right")
        elm.Resistor().endpoints((x0, ypd), (x0, ypd - 2.4))
        T((x0 - 0.3, ypd - 1.2), "R62 10k\n(22k/47k)", halign="right")
        gnd((x0, ypd - 2.4))
        xc = 2.8
        W((x0, ypd), (xc, ypd))
        elm.Dot().at((xc, ypd))
        elm.Diode().endpoints((xc, ypd), (xc, ypd - 1.2))
        elm.Diode().endpoints((xc, ypd - 1.2), (xc, ypd - 2.4))
        T((xc + 0.4, ypd - 1.2), "D11\nBAV99\n(クランプ)")
        gnd((xc, ypd - 2.4))
        cmp_ = elm.Opamp().theta(0).flip().at((6.4, ypd)).anchor("in1")
        W((xc, ypd), cmp_.in1)
        T((cmp_.in1[0] + 0.3, cmp_.in1[1] - 0.75), "U5 TLV3201", fontsize=9)
        yv = cmp_.in2[1]
        xv = 4.6
        W((xv, yv), cmp_.in2)
        elm.Dot().at((xv, yv))
        T((xv + 0.1, yv - 0.3), "VTH≈0.30V", fontsize=9)
        elm.Resistor().endpoints((xv, yv), (xv, yv + 2.0))
        T((xv - 0.3, yv + 1.0), "R63\n100k", halign="right")
        vdd((xv, yv + 2.0), "+3V3")
        elm.Resistor().endpoints((xv, yv), (xv - 1.6, yv))
        T((xv - 1.5, yv + 0.45), "R64 10k", fontsize=9)
        gnd((xv - 1.6, yv))
        xf = 5.4
        yf = yv + 1.3
        elm.Dot().at((xf, yv))
        W((xf, yv), (xf, yf))
        xo = cmp_.out[0] + 0.7
        elm.Resistor().endpoints((xf, yf), (xo, yf))
        T((xf + 0.8, yf + 0.45), "R65 1MΩ (ヒステリシス)", fontsize=9)
        W((xo, yf), (xo, cmp_.out[1]))
        W(cmp_.out, (xo, cmp_.out[1]))
        elm.Dot().at((xo, cmp_.out[1]))
        yo = cmp_.out[1]
        W((xo, yo), (xo + 1.6, yo))
        T((xo + 0.1, yo - 0.35), "RX_OPT_N", fontsize=9)
        a = logic.And().theta(0).at((xo + 1.6, yo)).anchor("in2")
        T((a.out[0] - 2.0, a.out[1] - 1.0), "U6 74LVC1G08", fontsize=9)
        W(a.in1, (a.in1[0] - 0.6, a.in1[1]))
        W((a.in1[0] - 0.6, a.in1[1]), (a.in1[0] - 0.6, a.in1[1] + 1.4))
        elm.Dot(open=True).at((a.in1[0] - 0.6, a.in1[1] + 1.4))
        T((a.in1[0] - 0.9, a.in1[1] + 1.8), "CAN_TX (PA12)")
        W(a.out, (a.out[0] + 0.8, a.out[1]))
        elm.Dot(open=True).at((a.out[0] + 0.8, a.out[1]))
        T((a.out[0] + 1.0, a.out[1]), "PA11\nFDCAN1_RX")
        T((xo - 0.4, yo - 2.6), "CAN_RX = CAN_TX ∧ RX_OPT_N\n(0=ドミナントの負論理ワイヤードAND)", fontsize=10)


def half_bridge():
    with schemdraw.Drawing(file=str(OUT / "half_bridge.svg"), show=False) as d:
        vm = 10.0
        W((0, vm), (17.5, vm))
        T((0, vm + 0.4), "VM (モータ電源 9–20V)")
        xs = 13.57

        def hs_driver():
            yb = 6.0
            elm.Dot(open=True).at((0, yb))
            T((-0.25, yb), "PA8 PWM_AH\n(TIM1_CH1)", halign="right")
            elm.Resistor().endpoints((0, yb), (2.4, yb))
            T((0.6, yb + 0.5), "R20 1k")
            elm.Dot().at((2.4, yb))
            elm.Resistor().endpoints((2.4, yb), (2.4, yb - 2.0))
            T((2.1, yb - 1.0), "R21\n100k", halign="right")
            gnd((2.4, yb - 2.0))
            W((2.4, yb), (3.0, yb))
            q = elm.BjtNpn(circle=True).theta(0).at((3.0, yb)).anchor("base")
            T((q.collector[0] + 0.3, yb + 0.2), "Q5\nMMBT3904", fontsize=9)
            elm.Resistor().endpoints(q.emitter, (q.emitter[0], q.emitter[1] - 1.1))
            T((q.emitter[0] + 0.3, q.emitter[1] - 0.55), "R22 1k", fontsize=9)
            gnd((q.emitter[0], q.emitter[1] - 1.1))
            yn = 7.5
            W(q.collector, (q.collector[0], yn))
            elm.Dot().at((q.collector[0], yn))
            T((q.collector[0] - 0.3, yn), "N_AH", halign="right")
            elm.Resistor().endpoints((q.collector[0], yn), (q.collector[0], vm))
            T((q.collector[0] + 0.3, (yn + vm) / 2), "R23\n4.7k")
            return q.collector[0], yn

        def totem(xn, yn, top, top_is_vdd, name_n, name_p, rg, gname, gate_x, pull, pull_to_vm):
            W((xn, yn), (6.0, yn))
            elm.Dot().at((6.0, yn))
            W((6.0, yn + 0.7), (6.0, yn - 0.7))
            W((6.0, yn + 0.7), (6.5, yn + 0.7))
            W((6.0, yn - 0.7), (6.5, yn - 0.7))
            qn = elm.BjtNpn(circle=True).theta(0).at((6.5, yn + 0.7)).anchor("base")
            qp = elm.BjtPnp(circle=True).theta(0).at((6.5, yn - 0.7)).anchor("base")
            T((qn.collector[0] + 0.25, qn.collector[1] + 0.1), name_n, fontsize=9)
            T((qp.collector[0] + 0.25, qp.collector[1] - 0.1), name_p, fontsize=9)
            if top_is_vdd:
                W(qn.collector, (qn.collector[0], qn.collector[1] + 0.3))
                vdd((qn.collector[0], qn.collector[1] + 0.3), "VGD")
            else:
                W(qn.collector, (qn.collector[0], top))
            W(qp.collector, (qp.collector[0], qp.collector[1] - 0.3))
            gnd((qp.collector[0], qp.collector[1] - 0.3))
            xe = qn.emitter[0]
            xg = 10.0
            elm.Resistor().endpoints((xe, yn), (xg, yn))
            T((xe + 0.6, yn + 0.45), rg, fontsize=9)
            elm.Dot().at((xg, yn))
            T((xg + 0.05, yn - 0.35), gname, fontsize=9)
            W((xg, yn), (gate_x, yn))
            return xg

        xn, yn = hs_driver()
        xg = totem(xn, yn, vm, False, "Q6 BC817", "Q7 BC807", "R24 10Ω", "GH_A", 12.2, None, True)
        elm.Resistor().endpoints((xg, yn), (xg, vm))
        T((xg - 0.3, (yn + vm) / 2 + 0.2), "R25\n10k", halign="right", fontsize=9)
        elm.Dot().at((11.1, yn))
        elm.Zener().endpoints((11.1, yn), (11.1, vm))
        T((11.35, (yn + vm) / 2 + 0.4), "D6\n15V", fontsize=9)
        qhp = elm.PFet(bulk=False).theta(0).reverse().at((12.2, yn)).anchor("gate")
        W(qhp.source, (qhp.source[0], vm))
        elm.Dot().at((qhp.source[0], vm))
        T((xs + 0.35, yn + 0.1), "Q4-P\nDMC4040SSD\n(Pch)", fontsize=9)
        ymot = 4.6
        W(qhp.drain, (xs, ymot))
        elm.Dot().at((xs, ymot))
        W((xs, ymot), (16.6, ymot))
        elm.Dot(open=True).at((16.6, ymot))
        T((16.8, ymot), "MOT_A\n(J2-1)")

        yl = -0.6
        elm.Dot(open=True).at((0, yl))
        T((-0.25, yl), "PA7 PWM_AL\n(TIM1_CH1N)", halign="right")
        elm.Resistor().endpoints((0, yl), (2.4, yl))
        T((0.6, yl + 0.5), "R26 1k")
        elm.Dot().at((2.4, yl))
        elm.Resistor().endpoints((2.4, yl), (2.4, yl - 2.0))
        T((2.1, yl - 1.0), "R27\n10k", halign="right")
        gnd((2.4, yl - 2.0))
        W((2.4, yl), (3.0, yl))
        q8 = elm.BjtNpn(circle=True).theta(0).at((3.0, yl)).anchor("base")
        T((q8.collector[0] + 0.3, yl + 0.2), "Q8\nMMBT3904", fontsize=9)
        W(q8.emitter, (q8.emitter[0], q8.emitter[1] - 0.3))
        gnd((q8.emitter[0], q8.emitter[1] - 0.3))
        ynl = 0.8
        W(q8.collector, (q8.collector[0], ynl))
        elm.Dot().at((q8.collector[0], ynl))
        T((q8.collector[0] - 0.3, ynl), "N_AL", halign="right")
        elm.Resistor().endpoints((q8.collector[0], ynl), (q8.collector[0], ynl + 1.6))
        T((q8.collector[0] + 0.3, ynl + 0.8), "R28 2.2k", fontsize=9)
        vdd((q8.collector[0], ynl + 1.6), "VGD")
        xg2 = totem(q8.collector[0], ynl, None, True, "Q9 BC817", "Q10 BC807", "R29 10Ω", "GL_A", 12.2, None, False)
        elm.Resistor().endpoints((xg2, ynl), (xg2, ynl - 2.0))
        T((xg2 - 0.3, ynl - 1.0), "R30\n10k", halign="right", fontsize=9)
        gnd((xg2, ynl - 2.0))
        qln = elm.NFet(bulk=False).theta(0).reverse().at((12.2, ynl)).anchor("gate")
        W(qln.drain, (xs, ymot))
        T((xs + 0.35, ynl - 0.1), "Q4-N\nDMC4040SSD\n(Nch)", fontsize=9)
        yi = ynl - 1.6
        W(qln.source, (xs, yi))
        elm.Dot().at((xs, yi))
        elm.Resistor().endpoints((xs, yi), (xs, yi - 2.0))
        T((xs + 0.3, yi - 1.0), "R42\n20mΩ 1W", fontsize=9)
        gnd((xs, yi - 2.0))
        W((xs, yi), (16.6, yi))
        elm.Dot(open=True).at((16.6, yi))
        T((16.8, yi), "ISNS\n→ Q11-N ソース (B側)\n→ R43 100Ω → PA1")
        T((0, -4.0), "B側 (Q11, Q12–Q17, R31–R41, D7) は同一構成。PA9=PWM_BH (TIM1_CH2), PB0=PWM_BL (TIM1_CH2N), 出力 MOT_B (J2-2)。", fontsize=10)
        T((0, -4.6), "VGD: VM → R19 4.7k → D5 (12V) / Q3 BC817 エミッタフォロワ ≈ 11.3V (VM≧12.5V 時)", fontsize=10)


def power():
    with schemdraw.Drawing(file=str(OUT / "power.svg"), show=False) as d:
        rail = 10.0
        elm.Dot(open=True).at((0, rail))
        T((-0.25, rail), "J1 VBUS", halign="right")
        elm.Fuse().endpoints((0, rail), (2.0, rail))
        T((0.5, rail + 0.5), "F1 5A")
        W((2.0, rail), (20.0, rail))
        T((2.2, rail + 0.4), "VBUS")
        for x in (2.6, 3.8):
            elm.Dot().at((x, rail))
        elm.DiodeTVS().endpoints((2.6, rail), (2.6, rail - 2.0)).reverse()
        T((2.3, rail - 1.0), "D1\nSMBJ22A", halign="right", fontsize=9)
        gnd((2.6, rail - 2.0))
        elm.Capacitor().endpoints((3.8, rail), (3.8, rail - 2.0))
        T((4.05, rail - 1.0), "C1 4.7µF\nC2 100nF", fontsize=9)
        gnd((3.8, rail - 2.0))

        u1 = elm.Ic(pins=[elm.IcPin(name="VDD", side="top", slot="1/2"),
                          elm.IcPin(name="VBUS", side="top", slot="2/2"),
                          elm.IcPin(name="CC1", side="left", slot="4/4"),
                          elm.IcPin(name="CC2", side="left", slot="3/4"),
                          elm.IcPin(name="DP", side="left", slot="2/4"),
                          elm.IcPin(name="DM", side="left", slot="1/4"),
                          elm.IcPin(name="GND", side="bottom"),
                          elm.IcPin(name="CFG1", side="right", slot="4/4"),
                          elm.IcPin(name="CFG2", side="right", slot="3/4"),
                          elm.IcPin(name="CFG3", side="right", slot="2/4"),
                          elm.IcPin(name="PG", side="right", slot="1/4")],
                    size=(3.6, 3.6), pinspacing=0.8).right().at((7.0, 6.2)).anchor("VDD")
        T((u1.center[0] - 1.0, u1.center[1] - 0.1), "U1\nCH224K", fontsize=11)
        xr = u1.VDD[0]
        elm.Dot().at((xr, rail))
        elm.Resistor().endpoints((xr, rail), (xr, 7.4))
        T((xr - 0.3, 8.7), "R1 1kΩ\n0.75W", halign="right", fontsize=9)
        elm.Dot().at((xr, 7.4))
        T((xr + 0.15, 7.15), "VDD_PD", fontsize=9)
        W((xr, 7.4), u1.VDD)
        elm.Capacitor().endpoints((xr, 7.4), (xr - 1.6, 7.4))
        T((xr - 1.6, 7.9), "C3 1µF", fontsize=9)
        gnd((xr - 1.6, 7.4))
        xb = u1.VBUS[0]
        elm.Dot().at((xb, rail))
        elm.Resistor().endpoints(u1.VBUS, (xb, rail))
        T((xb + 0.3, 8.2), "R66 0Ω", fontsize=9)
        for nm, lab in (("CC1", "J1 CC1"), ("CC2", "J1 CC2"), ("DP", "J1 D+"), ("DM", "J1 D−")):
            p = getattr(u1, nm)
            W(p, (p[0] - 0.9, p[1]))
            elm.Dot(open=True).at((p[0] - 0.9, p[1]))
            T((p[0] - 1.1, p[1]), lab, halign="right", fontsize=9)
        W(u1.GND, (u1.GND[0], u1.GND[1] - 0.3))
        gnd((u1.GND[0], u1.GND[1] - 0.3))
        for nm, lab in (("CFG1", "R5 100Ω → PB5"), ("CFG2", "R6 100Ω → PB7"), ("CFG3", "R7 100Ω → PA6"), ("PG", "PD_PG → PB4  (R9 10k↑+3V3, D2/R10 LED)")):
            p = getattr(u1, nm)
            W(p, (p[0] + 0.9, p[1]))
            elm.Dot(open=True).at((p[0] + 0.9, p[1]))
            T((p[0] + 1.1, p[1]), lab, fontsize=9)
        T((u1.center[0] - 2.0, u1.GND[1] - 1.5), "オプションB: U1B CH221K (SOT-23-6) — CFG は R8 で VDD_PD へ (100k: 15V)\nCFG を VBUS に接続しないこと (CFG 耐圧 6.5V)", fontsize=9)

        xbk = 12.6
        elm.Dot().at((xbk, rail))
        u2 = elm.Ic(pins=[elm.IcPin(name="VIN", side="left", slot="2/2"),
                          elm.IcPin(name="EN", side="left", slot="1/2"),
                          elm.IcPin(name="SW", side="right", slot="2/2"),
                          elm.IcPin(name="FB", side="right", slot="1/2"),
                          elm.IcPin(name="BST", side="top"),
                          elm.IcPin(name="GND", side="bottom")],
                    size=(2.4, 2.0)).right().at((xbk + 0.9, 8.0)).anchor("VIN")
        W((xbk, rail), (xbk, 8.0))
        W((xbk, 8.0), u2.VIN)
        T((u2.center[0] - 0.9, u2.center[1] - 0.2), "U2\nAP63203WU", fontsize=9)
        T((u2.EN[0] - 0.1, u2.EN[1] - 0.35), "EN: R11 100k→VIN", halign="right", fontsize=8)
        T((u2.BST[0] + 0.15, u2.BST[1] + 0.25), "BST: C5 100nF→SW", fontsize=8)
        W(u2.SW, (u2.SW[0] + 0.3, u2.SW[1]))
        elm.Inductor2().endpoints((u2.SW[0] + 0.3, u2.SW[1]), (u2.SW[0] + 2.3, u2.SW[1]))
        T((u2.SW[0] + 0.6, u2.SW[1] + 0.5), "L1 4.7µH", fontsize=9)
        xo = u2.SW[0] + 2.3
        elm.Dot().at((xo, u2.SW[1]))
        T((xo + 0.1, u2.SW[1] + 0.35), "+3V3", fontsize=10)
        elm.Capacitor().endpoints((xo, u2.SW[1]), (xo, u2.SW[1] - 1.6))
        T((xo + 0.25, u2.SW[1] - 0.8), "C6,C7\n22µF×2", fontsize=9)
        gnd((xo, u2.SW[1] - 1.6))
        W(u2.FB, (u2.FB[0] + 0.3, u2.FB[1]))
        W((u2.FB[0] + 0.3, u2.FB[1]), (u2.FB[0] + 0.3, u2.FB[1] - 0.9))
        W((u2.FB[0] + 0.3, u2.FB[1] - 0.9), (xo - 0.4, u2.FB[1] - 0.9))
        W((xo - 0.4, u2.FB[1] - 0.9), (xo - 0.4, u2.SW[1]))
        elm.Dot().at((xo - 0.4, u2.SW[1]))
        W(u2.GND, (u2.GND[0], u2.GND[1] - 0.3))
        gnd((u2.GND[0], u2.GND[1] - 0.3))

        xq = 26.0
        W((20.0, rail), (xq, rail))
        W((xq, rail), (xq, rail - 1.0))
        q1 = elm.PFet(bulk=False).theta(0).reverse().at((xq, rail - 1.0)).anchor("source")
        T((xq + 0.3, q1.center[1] + 0.1), "Q1\nAO4407A", fontsize=9)
        yg = q1.gate[1]
        xz, xr12, xgj = 22.6, 23.8, 24.6
        W((xz, yg), q1.gate)
        for x in (xz, xr12):
            elm.Dot().at((x, rail))
        elm.Dot().at((xr12, yg))
        elm.Zener().endpoints((xz, yg), (xz, rail))
        T((xz - 0.3, yg + 0.8), "D3\n12V", halign="right", fontsize=9)
        elm.Resistor().endpoints((xr12, yg), (xr12, rail))
        T((xr12 + 0.2, yg + 1.05), "R12\n100k", fontsize=8)
        ymid = yg - 2.2
        elm.Resistor().endpoints((xr12, yg), (xr12, ymid))
        T((xr12 - 0.3, yg - 1.1), "R13\n10k", halign="right", fontsize=9)
        q2 = elm.NFet(bulk=False).theta(0).reverse().at((xr12, ymid)).anchor("drain")
        W(q2.source, (q2.source[0], q2.source[1] - 0.3))
        gnd((q2.source[0], q2.source[1] - 0.3))
        T((xr12 + 0.3, ymid - 0.75), "Q2 2N7002", fontsize=9)
        W(q2.gate, (q2.gate[0] - 0.6, q2.gate[1]))
        elm.Dot(open=True).at((q2.gate[0] - 0.6, q2.gate[1]))
        T((q2.gate[0] - 0.8, q2.gate[1]), "PA10 LOAD_EN\n(R15 100Ω, R16 100k↓)", halign="right", fontsize=9)
        yvm = q1.drain[1] - 1.0
        W(q1.drain, (xq, yvm))
        elm.Dot().at((xq, yvm))
        T((xq + 0.15, yvm + 0.35), "VM", fontsize=11)
        elm.Resistor().endpoints((xgj, yg), (xgj, yvm))
        T((xgj + 0.2, yg - 0.9), "R14\n1k", fontsize=8)
        elm.Capacitor().endpoints((xgj, yvm), (xq, yvm))
        T((xgj + 0.1, yvm - 0.55), "C8 470nF", fontsize=8)
        for x in (xgj,):
            elm.Dot().at((x, yg))
        xe = xq + 3.8
        W((xq, yvm), (xe, yvm))
        for x, el, lab in ((xq + 1.2, "c", "C9 470µF\nC10,C11 10µF"), (xq + 2.6, "t", "D4\nSMBJ24A")):
            elm.Dot().at((x, yvm))
            if el == "c":
                elm.Capacitor(polar=True).endpoints((x, yvm), (x, yvm - 2.0))
            else:
                elm.DiodeTVS().endpoints((x, yvm), (x, yvm - 2.0)).reverse()
            T((x + 0.25, yvm - 1.0), lab, fontsize=8)
            gnd((x, yvm - 2.0))
        elm.Dot(open=True).at((xe, yvm))
        T((xe + 0.2, yvm), "→ Hブリッジ\n→ VGD 生成\n→ R17/R18 → PA4")


def blocks():
    with schemdraw.Drawing(file=str(OUT / "block.svg"), show=False) as d:
        d.config(fontsize=11, lw=1.2)

        def box(x, y, w, h, t, fill="#eef4fb"):
            return flow.Box(w=w, h=h).at((x, y)).anchor("center").label(t).fill(fill)

        usb = box(0, 4, 2.6, 1.3, "USB Type-C\nJ1")
        pd = box(4.2, 4, 3.0, 1.3, "PD シンク\nCH224K / CH221K", "#fff4e0")
        ls = box(8.8, 4, 3.0, 1.3, "ロードスイッチ\nQ1 ソフトスタート")
        hb = box(13.4, 4, 3.2, 1.3, "ディスクリート\nHブリッジ", "#fde8e8")
        mot = box(17.6, 4, 2.6, 1.3, "DCモータ\n(サーボ機構)", "#f3f3f3")
        buck = box(1.0, 0.8, 2.8, 1.2, "降圧 3.3V\nU2", "#eef4fb")
        mcu = box(8.8, 0.4, 3.6, 2.8, "MCU\nSTM32G431KB\nTIM1・FDCAN\nADC・OPAMP・COMP", "#e8f6ea")
        gdrv = box(13.4, 1.4, 3.2, 1.2, "ゲート駆動\n(トランジスタ)", "#fde8e8")
        sens = box(13.6, -1.2, 3.6, 1.4, "電流・電圧・温度\nポテンショ・エンコーダ")
        opt = box(4.2, -2.6, 3.6, 1.6, "光 I/O (光CAN)\n赤外LED / PD\n比較器 / AND", "#efe8fb")
        host = box(-0.4, -2.6, 3.0, 1.6, "上位機器\n(同一の光\nフロントエンド)", "#f3f3f3")
        elm.Line().at(usb.E).to(pd.W)
        elm.Arrow().at(pd.E).to(ls.W).label("VBUS", loc="top", fontsize=9)
        elm.Arrow().at(ls.E).to(hb.W).label("VM", loc="top", fontsize=9)
        elm.Arrow().at(hb.E).to(mot.W)
        elm.Wire("|-", arrow="->").at((3.4, 3.35)).to(buck.E).label("VBUS", loc="start", fontsize=9, ofst=(-0.35, -0.6))
        elm.Wire("|-", arrow="->").at(buck.S).to((7.0, -0.4))
        elm.Label().at((4.4, -0.15)).label("+3V3", fontsize=9)
        elm.Wire("|-", arrow="->").at((5.4, 3.35)).to((7.0, 1.2))
        elm.Label().at((6.2, 1.45)).label("PG", fontsize=9)
        elm.Wire("-|", arrow="->").at((7.0, 0.6)).to((4.8, 3.35))
        elm.Label().at((6.0, 0.35)).label("CFG1–3", fontsize=9)
        elm.Arrow().at(mcu.N).to(ls.S).label("LOAD_EN", loc="bottom", fontsize=9)
        elm.Arrow().at((10.6, 1.4)).to(gdrv.W).label("PWM×4", loc="top", fontsize=9)
        elm.Arrow().at(gdrv.N).to(hb.S)
        elm.Arrow().at(sens.W).to((10.6, -1.2)).label("ADC", loc="top", fontsize=9)
        elm.Wire("|-", arrow="->").at((8.2, -1.0)).to((6.0, -2.3))
        elm.Label().at((7.0, -2.05)).label("TX", fontsize=9)
        elm.Wire("-|", arrow="->").at((6.0, -2.9)).to((9.4, -1.0))
        elm.Label().at((7.4, -3.15)).label("RX", fontsize=9)
        elm.Arrow(double=True).at(opt.W).to(host.E).color("#7b3fbf")
        elm.Label().at((1.9, -1.95)).label("赤外光", fontsize=9, color="#7b3fbf")


def timing():
    w = {
        "signal": [
            {"name": "CAN_TX (局A)", "wave": "1.0..1.0.1.."},
            {"name": "IR 光出力 (局A)", "wave": "0.1..0.1.0.."},
            {"name": "RX_OPT_N (局B)", "wave": "1..0..1.0.1."},
            {"name": "CAN_RX (局B)", "wave": "1..0..1.0.1."},
        ],
    }
    with schemdraw.Drawing(file=str(OUT / "optical_timing.svg"), show=False) as d:
        d.config(margin=1.5)
        logic.TimingDiagram(w, ygap=0.55, risetime=0.08)


if __name__ == "__main__":
    optical()
    half_bridge()
    power()
    blocks()
    timing()
