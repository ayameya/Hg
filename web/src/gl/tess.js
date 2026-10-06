import earcut from "earcut";

export const LINE_STRIDE = 6;
const MITER_LIMIT = 2;

export class Growable {
  constructor(Type, initial = 1024) {
    this.Type = Type;
    this.data = new Type(initial);
    this.length = 0;
  }

  reserve(n) {
    if (this.length + n <= this.data.length) return;
    let size = this.data.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new this.Type(size);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }

  push1(a) {
    this.reserve(1);
    this.data[this.length++] = a;
  }

  push2(a, b) {
    this.reserve(2);
    this.data[this.length++] = a;
    this.data[this.length++] = b;
  }

  push3(a, b, c) {
    this.reserve(3);
    this.data[this.length++] = a;
    this.data[this.length++] = b;
    this.data[this.length++] = c;
  }

  push6(a, b, c, d, e, f) {
    this.reserve(6);
    const o = this.length;
    this.data[o] = a;
    this.data[o + 1] = b;
    this.data[o + 2] = c;
    this.data[o + 3] = d;
    this.data[o + 4] = e;
    this.data[o + 5] = f;
    this.length += 6;
  }

  final() {
    return this.data.slice(0, this.length);
  }
}

function signedArea(ring) {
  let s = 0;
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) s += (ring[j] - ring[i]) * (ring[i + 1] + ring[j + 1]);
  return s;
}

export function groupRings(parts) {
  const polys = [];
  let cur = null;
  let ccw;
  for (const ring of parts) {
    if (ring.length < 6) continue;
    const a = signedArea(ring);
    if (a === 0) continue;
    if (ccw === undefined) ccw = a < 0;
    if (ccw === a < 0 || !cur) {
      cur = [ring];
      polys.push(cur);
    } else {
      cur.push(ring);
    }
  }
  return polys;
}

export class FillBuilder {
  constructor() {
    this.pos = new Growable(Float32Array, 4096);
    this.idx = new Growable(Uint32Array, 4096);
    this.outline = new Growable(Uint32Array, 1024);
  }

  get vertexCount() {
    return this.pos.length / 2;
  }

  addPolygon(rings, withOutline) {
    const base = this.vertexCount;
    const flat = [];
    const holes = [];
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      if (r > 0) holes.push(flat.length / 2);
      const closed = ring[0] === ring[ring.length - 2] && ring[1] === ring[ring.length - 1];
      const n = closed ? ring.length - 2 : ring.length;
      const start = flat.length / 2;
      for (let i = 0; i < n; i++) flat.push(ring[i]);
      if (withOutline) {
        const cnt = n / 2;
        for (let i = 0; i < cnt; i++) this.outline.push2(base + start + i, base + start + ((i + 1) % cnt));
      }
    }
    const tri = earcut(flat, holes.length ? holes : null, 2);
    this.pos.reserve(flat.length);
    for (let i = 0; i < flat.length; i++) this.pos.data[this.pos.length++] = flat[i];
    this.idx.reserve(tri.length);
    for (let i = 0; i < tri.length; i++) this.idx.data[this.idx.length++] = base + tri[i];
  }
}

export class LineBuilder {
  constructor() {
    this.v = new Growable(Float32Array, 8192);
    this.idx = new Growable(Uint32Array, 8192);
  }

  get vertexCount() {
    return this.v.length / LINE_STRIDE;
  }

  addLine(coords, closed = false) {
    const pts = [];
    const n0 = coords.length / 2;
    for (let i = 0; i < n0; i++) {
      const x = coords[2 * i];
      const y = coords[2 * i + 1];
      const l = pts.length;
      if (l && pts[l - 2] === x && pts[l - 1] === y) continue;
      pts.push(x, y);
    }
    if (closed && pts.length >= 6 && (pts[0] !== pts[pts.length - 2] || pts[1] !== pts[pts.length - 1])) pts.push(pts[0], pts[1]);
    const n = pts.length / 2;
    if (n < 2) return;
    const base = this.vertexCount;
    let dist = 0;
    let pnx = 0;
    let pny = 0;
    for (let i = 0; i < n; i++) {
      const x = pts[2 * i];
      const y = pts[2 * i + 1];
      let nx;
      let ny;
      let scale = 1;
      let segx = 0;
      let segy = 0;
      if (i < n - 1) {
        const dx = pts[2 * i + 2] - x;
        const dy = pts[2 * i + 3] - y;
        const len = Math.hypot(dx, dy) || 1;
        segx = -dy / len;
        segy = dx / len;
      }
      if (i === 0) {
        nx = segx;
        ny = segy;
      } else if (i === n - 1) {
        nx = pnx;
        ny = pny;
      } else {
        let mx = pnx + segx;
        let my = pny + segy;
        const ml = Math.hypot(mx, my);
        if (ml < 1e-6) {
          mx = segx;
          my = segy;
        } else {
          mx /= ml;
          my /= ml;
        }
        const dot = mx * segx + my * segy;
        scale = Math.min(MITER_LIMIT, 1 / Math.max(dot, 1e-3));
        nx = mx;
        ny = my;
      }
      if (i > 0) dist += Math.hypot(x - pts[2 * i - 2], y - pts[2 * i - 1]);
      this.v.push6(x, y, nx * scale, ny * scale, 1, dist);
      this.v.push6(x, y, -nx * scale, -ny * scale, -1, dist);
      if (i < n - 1) {
        pnx = segx;
        pny = segy;
        const a = base + 2 * i;
        this.idx.push3(a, a + 1, a + 2);
        this.idx.push3(a + 1, a + 3, a + 2);
      }
    }
  }
}
