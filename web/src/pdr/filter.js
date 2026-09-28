const D2R = Math.PI / 180;
const MPD = 111320;

function angDiff(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function bearingDeg(a, b) {
  const k = Math.cos(a[1] * D2R);
  return (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) / D2R + 360) % 360;
}

function segMeters(a, b) {
  const k = Math.cos(a[1] * D2R);
  return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * MPD;
}

export class GraphParticleFilter {
  constructor(net, opts = {}) {
    this.net = net;
    this.n = opts.n || 300;
    this.rand = opts.rand || Math.random;
    this.sigmaHeading = opts.sigmaHeading || 35;
    this.geomCache = new Map();
    this.active = false;
    this.free = null;
    this.e = new Int32Array(this.n);
    this.off = new Float64Array(this.n);
    this.dir = new Int8Array(this.n);
    this.w = new Float64Array(this.n);
    this.scale = new Float64Array(this.n).fill(1);
    this.bias = new Float64Array(this.n);
    this.stepsSinceFix = 0;
    this.lost = 0;
  }

  gauss() {
    return Math.sqrt(-2 * Math.log(this.rand() + 1e-12)) * Math.cos(2 * Math.PI * this.rand());
  }

  geom(i) {
    let g = this.geomCache.get(i);
    if (!g) {
      const pts = this.net.edges[i][this.net.ef.coords];
      const cum = [0];
      for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + segMeters(pts[j - 1], pts[j]));
      g = { pts, cum, L: Math.max(cum[cum.length - 1], 0.01) };
      this.geomCache.set(i, g);
    }
    return g;
  }

  pointAt(i, off) {
    const { pts, cum, L } = this.geom(i);
    const o = Math.max(0, Math.min(L, off));
    let j = 1;
    while (j < cum.length - 1 && cum[j] < o) j++;
    const seg = cum[j] - cum[j - 1] || 1;
    const t = (o - cum[j - 1]) / seg;
    const a = pts[j - 1];
    const b = pts[j];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, bearingDeg(a, b)];
  }

  level(i) {
    return this.net.edges[i][this.net.ef.level];
  }

  candidates(lon, lat, radius, level) {
    const out = [];
    const { ef } = this.net;
    for (const i of this.net.edgesNear(lon, lat, radius)) {
      const e = this.net.edges[i];
      if (level != null && Math.abs(e[ef.level] - level) > 0.6 && !e[ef.connector]) continue;
      const { pts, cum } = this.geom(i);
      const k = Math.cos(lat * D2R);
      let best = null;
      for (let j = 0; j < pts.length - 1; j++) {
        const ax = (pts[j][0] - lon) * k * MPD;
        const ay = (pts[j][1] - lat) * MPD;
        const bx = (pts[j + 1][0] - lon) * k * MPD;
        const by = (pts[j + 1][1] - lat) * MPD;
        const dx = bx - ax;
        const dy = by - ay;
        const L2 = dx * dx + dy * dy;
        const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (!best || d < best.d) best = { d, off: cum[j] + t * (cum[j + 1] - cum[j]) };
      }
      if (best && best.d <= radius) out.push({ edge: i, ...best });
    }
    return out;
  }

  init(lon, lat, { radius = 20, level = null } = {}) {
    this.free = { lon, lat, level };
    this.stepsSinceFix = 0;
    let cands = this.candidates(lon, lat, radius, level);
    if (!cands.length && level != null) cands = this.candidates(lon, lat, radius, null);
    if (!cands.length) {
      this.active = false;
      return false;
    }
    const sigma = Math.max(3, radius / 2);
    const cw = cands.map((c) => Math.exp(-(c.d * c.d) / (2 * sigma * sigma)) * Math.max(1, this.geom(c.edge).L / 10));
    const total = cw.reduce((s, v) => s + v, 0);
    for (let p = 0; p < this.n; p++) {
      let r = this.rand() * total;
      let k = 0;
      while (k < cands.length - 1 && r > cw[k]) r -= cw[k++];
      const c = cands[k];
      const L = this.geom(c.edge).L;
      this.e[p] = c.edge;
      this.off[p] = Math.max(0, Math.min(L, c.off + this.gauss() * Math.min(radius / 3, 6)));
      this.dir[p] = this.rand() < 0.5 ? 1 : -1;
      this.w[p] = 1 / this.n;
      if (!this.keepCalibration) {
        this.scale[p] = Math.max(0.75, Math.min(1.3, 1 + 0.1 * this.gauss()));
        this.bias[p] = 10 * this.gauss();
      }
    }
    this.active = true;
    this.lost = 0;
    return true;
  }

  localBearing(p) {
    const b = this.pointAt(this.e[p], this.off[p])[2];
    return this.dir[p] > 0 ? b : (b + 180) % 360;
  }

  leaveBearing(edge, fromNode) {
    const { ef } = this.net;
    const e = this.net.edges[edge];
    const { pts } = this.geom(edge);
    if (e[ef.a] === fromNode) return bearingDeg(pts[0], pts[Math.min(1, pts.length - 1)]);
    return bearingDeg(pts[pts.length - 1], pts[Math.max(0, pts.length - 2)]);
  }

  move(p, dist, heading) {
    const { ef } = this.net;
    let remaining = dist;
    for (let hop = 0; hop < 20 && remaining > 0; hop++) {
      const edge = this.e[p];
      const L = this.geom(edge).L;
      const avail = this.dir[p] > 0 ? L - this.off[p] : this.off[p];
      if (remaining <= avail) {
        this.off[p] += this.dir[p] * remaining;
        return true;
      }
      remaining -= avail;
      const e = this.net.edges[edge];
      const node = this.dir[p] > 0 ? e[ef.b] : e[ef.a];
      const options = this.net.adj[node].filter((c) => c !== edge && (this.net.usable[c] || this.ignoreUsable));
      if (!options.length) {
        this.off[p] = this.dir[p] > 0 ? L : 0;
        return false;
      }
      const ws = options.map((c) => (heading == null ? 1 : Math.exp(-(angDiff(heading, this.leaveBearing(c, node)) ** 2) / (2 * 45 * 45)) + 0.02));
      const total = ws.reduce((s, v) => s + v, 0);
      let r = this.rand() * total;
      let k = 0;
      while (k < options.length - 1 && r > ws[k]) r -= ws[k++];
      const next = options[k];
      const ne = this.net.edges[next];
      this.e[p] = next;
      this.dir[p] = ne[ef.a] === node ? 1 : -1;
      this.off[p] = this.dir[p] > 0 ? 0 : this.geom(next).L;
    }
    return true;
  }

  step(length, heading) {
    this.stepsSinceFix += 1;
    if (this.free) {
      const k = Math.cos(this.free.lat * D2R);
      if (heading != null) {
        this.free.lon += (length * Math.sin(heading * D2R)) / (MPD * k);
        this.free.lat += (length * Math.cos(heading * D2R)) / MPD;
      }
    }
    if (!this.active) return;
    const sigma = this.sigmaHeading;
    let meanLike = 0;
    for (let p = 0; p < this.n; p++) {
      this.bias[p] += 0.5 * this.gauss();
      this.scale[p] = Math.max(0.7, Math.min(1.35, this.scale[p] + 0.004 * this.gauss()));
      const hp = heading == null ? null : (heading - this.bias[p] + 360) % 360;
      if (hp != null && angDiff(hp, this.localBearing(p)) > 110) this.dir[p] = -this.dir[p];
      const L = Math.max(0.1, length * this.scale[p] * (1 + 0.05 * this.gauss()));
      const ok = this.move(p, L, hp);
      let like = 1;
      if (hp != null) like = Math.exp(-(angDiff(hp, this.localBearing(p)) ** 2) / (2 * sigma * sigma)) + 0.02;
      if (!ok) like *= 0.25;
      meanLike += this.w[p] * like;
      this.w[p] *= like;
    }
    this.lost = meanLike < 0.12 ? this.lost + 1 : 0;
    if (this.lost >= 6) {
      const est = this.estimate();
      this.keepCalibration = true;
      this.init(est.lon, est.lat, { radius: 30 + Math.min(60, est.spread || 0) });
      this.keepCalibration = false;
      return;
    }
    this.normalize();
  }

  normalize() {
    let s = 0;
    for (let p = 0; p < this.n; p++) s += this.w[p];
    if (!(s > 1e-300)) {
      this.w.fill(1 / this.n);
      return;
    }
    let s2 = 0;
    for (let p = 0; p < this.n; p++) {
      this.w[p] /= s;
      s2 += this.w[p] * this.w[p];
    }
    if (1 / s2 < this.n / 2) this.resample();
  }

  resample() {
    const n = this.n;
    const e = new Int32Array(n);
    const off = new Float64Array(n);
    const dir = new Int8Array(n);
    const scale = new Float64Array(n);
    const bias = new Float64Array(n);
    const step = 1 / n;
    let u = this.rand() * step;
    let c = this.w[0];
    let i = 0;
    for (let p = 0; p < n; p++) {
      while (u > c && i < n - 1) c += this.w[++i];
      e[p] = this.e[i];
      dir[p] = this.dir[i];
      scale[p] = Math.max(0.7, Math.min(1.35, this.scale[i] + 0.01 * this.gauss()));
      bias[p] = this.bias[i] + 1.5 * this.gauss();
      const L = this.geom(e[p]).L;
      off[p] = Math.max(0, Math.min(L, this.off[i] + 1.0 * this.gauss()));
      u += step;
    }
    this.e = e;
    this.off = off;
    this.dir = dir;
    this.scale = scale;
    this.bias = bias;
    this.w.fill(1 / n);
  }

  nearKind(p, kind, radius) {
    const { ef } = this.net;
    const [lon, lat] = this.pointAt(this.e[p], this.off[p]);
    if (this.net.edges[this.e[p]][ef.highway] === kind) return true;
    for (const i of this.net.edgesNear(lon, lat, radius)) {
      if (this.net.edges[i][ef.highway] !== kind) continue;
      const { pts } = this.geom(i);
      for (const q of pts) if (segMeters([lon, lat], q) <= radius) return true;
    }
    return false;
  }

  stairs(confidence) {
    if (!this.active || confidence <= 0) return;
    const penalty = 1 - Math.min(0.8, confidence * 0.8);
    for (let p = 0; p < this.n; p++) {
      if (!this.nearKind(p, "steps", 12)) this.w[p] *= penalty;
    }
    this.normalize();
  }

  levelChange(dz) {
    const delta = Math.round(dz / 3.5) || Math.sign(dz);
    if (this.free && this.free.level != null) this.free.level += delta;
    if (!this.active) return;
    const { ef } = this.net;
    for (let p = 0; p < this.n; p++) {
      const [lon, lat] = this.pointAt(this.e[p], this.off[p]);
      const target = this.level(this.e[p]) + delta;
      const c = this.candidates(lon, lat, 25, target).filter((x) => Math.abs(this.net.edges[x.edge][ef.level] - target) < 0.6);
      if (c.length) {
        c.sort((a, b) => a.d - b.d);
        this.e[p] = c[0].edge;
        this.off[p] = c[0].off;
      } else {
        this.w[p] *= 0.1;
      }
    }
    this.normalize();
  }

  fix(lon, lat, accuracy = 10, level = null) {
    const acc = Math.max(3, accuracy);
    if (!this.active) return this.init(lon, lat, { radius: Math.min(60, acc * 2), level });
    let maxLike = 0;
    const like = new Float64Array(this.n);
    for (let p = 0; p < this.n; p++) {
      const [plon, plat] = this.pointAt(this.e[p], this.off[p]);
      const d = segMeters([plon, plat], [lon, lat]);
      let l = Math.exp(-(d * d) / (2 * acc * acc));
      if (level != null && Math.abs(this.level(this.e[p]) - level) > 0.6) l *= 0.2;
      like[p] = l;
      maxLike = Math.max(maxLike, l);
    }
    if (maxLike < 0.01) return this.init(lon, lat, { radius: Math.min(60, acc * 2), level });
    for (let p = 0; p < this.n; p++) this.w[p] *= like[p] + 1e-9;
    this.normalize();
    this.stepsSinceFix = 0;
    if (this.free) Object.assign(this.free, { lon, lat, level: level ?? this.free.level });
    return true;
  }

  estimate() {
    if (!this.active) return this.free ? { ...this.free, spread: null, mode: "free" } : null;
    const pts = [];
    for (let p = 0; p < this.n; p++) pts.push(this.pointAt(this.e[p], this.off[p]));
    const lat0 = pts[0][1];
    const k = Math.cos(lat0 * D2R);
    const cell = 12;
    const bins = new Map();
    pts.forEach((q, p) => {
      const key = `${Math.floor((q[0] * k * MPD) / cell)},${Math.floor((q[1] * MPD) / cell)}`;
      bins.set(key, (bins.get(key) || 0) + this.w[p]);
    });
    let bestKey = null;
    let bestW = -1;
    for (const [key, w] of bins) {
      if (w > bestW) {
        bestW = w;
        bestKey = key;
      }
    }
    const [bx, by] = bestKey.split(",").map(Number);
    const cx = (bx + 0.5) * cell;
    const cy = (by + 0.5) * cell;
    let sw = 0;
    let mx = 0;
    let my = 0;
    const levels = new Map();
    pts.forEach((q, p) => {
      const x = q[0] * k * MPD;
      const y = q[1] * MPD;
      if (Math.hypot(x - cx, y - cy) > 25) return;
      sw += this.w[p];
      mx += this.w[p] * x;
      my += this.w[p] * y;
      const lv = Math.round(this.level(this.e[p]));
      levels.set(lv, (levels.get(lv) || 0) + this.w[p]);
    });
    mx /= sw;
    my /= sw;
    let varAll = 0;
    pts.forEach((q, p) => {
      varAll += this.w[p] * ((q[0] * k * MPD - mx) ** 2 + (q[1] * MPD - my) ** 2);
    });
    let level = 0;
    let lw = -1;
    for (const [lv, w] of levels) {
      if (w > lw) {
        lw = w;
        level = lv;
      }
    }
    let sc = 0;
    let bi = 0;
    for (let p = 0; p < this.n; p++) {
      sc += this.w[p] * this.scale[p];
      bi += this.w[p] * this.bias[p];
    }
    return { lon: mx / (k * MPD), lat: my / MPD, level, spread: Math.sqrt(varAll), share: sw, mode: "network", stepScale: sc, headingBias: bi };
  }

  particles() {
    const out = [];
    for (let p = 0; p < this.n; p++) out.push(this.pointAt(this.e[p], this.off[p]));
    return out;
  }
}

export class Barometer {
  constructor() {
    this.alt = null;
    this.ref = null;
    this.pending = null;
    this.listeners = new Set();
  }

  on(fn) {
    this.listeners.add(fn);
  }

  push(t, hPa) {
    if (!Number.isFinite(hPa) || hPa < 800 || hPa > 1100) return;
    const alt = 44330 * (1 - (hPa / 1013.25) ** (1 / 5.255));
    this.alt = this.alt == null ? alt : this.alt + 0.25 * (alt - this.alt);
    if (this.ref == null) {
      this.ref = this.alt;
      return;
    }
    const dz = this.alt - this.ref;
    if (Math.abs(dz) > 2.6) {
      if (!this.pending || Math.sign(this.pending.dz) !== Math.sign(dz)) this.pending = { t, dz };
      this.pending.dz = dz;
      if (t - this.pending.t > 4000 && Math.abs(this.alt - this.lastAlt) < 0.3) {
        for (const fn of this.listeners) fn({ type: "floor", t, dz });
        this.ref = this.alt;
        this.pending = null;
      }
    } else {
      this.pending = null;
      this.ref += 0.002 * dz;
    }
    this.lastAlt = this.alt;
  }
}
