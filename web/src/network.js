import { isOpen, nextChange } from "./schedule.js";
import { isHoliday } from "./holidays.js";

const D2R = Math.PI / 180;
const MPD_LAT = 111320;

export function meters(a, b) {
  const la = a[1] * D2R;
  const lb = b[1] * D2R;
  const h = Math.sin((lb - la) / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(((b[0] - a[0]) * D2R) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

class Heap {
  constructor() {
    this.a = [];
  }

  push(d, v) {
    const a = this.a;
    a.push([d, v]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }

  get size() {
    return this.a.length;
  }
}

export class Network {
  constructor(raw) {
    this.raw = raw;
    this.ef = Object.fromEntries(raw.edge_fields.map((k, i) => [k, i]));
    this.nf = Object.fromEntries(raw.node_fields.map((k, i) => [k, i]));
    this.nodes = raw.nodes;
    this.edges = raw.edges;
    this.ohStrings = raw.oh;
    this.schedules = raw.schedules;
    this.notes = raw.notes;
    this.rules = Object.fromEntries((raw.rules || []).map((r) => [r.id, r]));
    const { ef, nf } = this;
    this.adj = Array.from({ length: this.nodes.length }, () => []);
    this.edges.forEach((e, i) => {
      this.adj[e[ef.a]].push(i);
      this.adj[e[ef.b]].push(i);
    });
    this.nodeLevel = new Float32Array(this.nodes.length);
    for (let i = 0; i < this.nodes.length; i++) {
      let lv = 0;
      for (const ei of this.adj[i]) lv = Math.min(lv, this.edges[ei][ef.level]);
      this.nodeLevel[i] = lv;
    }
    this.entrances = [];
    for (let i = 0; i < this.nodes.length; i++) if (this.nodes[i][nf.flags] & 2) this.entrances.push(i);
    this.edgeState = new Int8Array(this.edges.length).fill(-1);
    this.nodeOpen = new Uint8Array(this.nodes.length).fill(1);
    this.usable = new Uint8Array(this.edges.length);
    this.comp = new Int32Array(this.nodes.length);
    this.buildIndex();
  }

  edge(i) {
    const e = this.edges[i];
    const o = {};
    for (const [k, idx] of Object.entries(this.ef)) o[k] = e[idx];
    return o;
  }

  node(i) {
    const n = this.nodes[i];
    const o = {};
    for (const [k, idx] of Object.entries(this.nf)) o[k] = n[idx];
    return o;
  }

  schedule(idx) {
    return idx >= 0 ? this.schedules[idx] : null;
  }

  isHoliday(date) {
    return isHoliday(date);
  }

  ohOpen(idx, date) {
    return isOpen(this.schedule(idx), date);
  }

  nextChange(idx, date) {
    return nextChange(this.schedule(idx), date);
  }

  buildIndex() {
    const { ef } = this;
    this.cell = 0.0015;
    this.grid = new Map();
    const add = (key, v) => {
      let l = this.grid.get(key);
      if (!l) this.grid.set(key, (l = []));
      l.push(v);
    };
    this.edges.forEach((e, i) => {
      const cs = e[ef.coords];
      let minx = Infinity;
      let miny = Infinity;
      let maxx = -Infinity;
      let maxy = -Infinity;
      for (const [x, y] of cs) {
        minx = Math.min(minx, x);
        maxx = Math.max(maxx, x);
        miny = Math.min(miny, y);
        maxy = Math.max(maxy, y);
      }
      for (let gx = Math.floor(minx / this.cell); gx <= Math.floor(maxx / this.cell); gx++) {
        for (let gy = Math.floor(miny / this.cell); gy <= Math.floor(maxy / this.cell); gy++) add(`${gx},${gy}`, i);
      }
    });
  }

  edgesNear(lon, lat, radiusM) {
    const r = Math.ceil(radiusM / (this.cell * MPD_LAT * Math.cos(lat * D2R))) + 1;
    const gx = Math.floor(lon / this.cell);
    const gy = Math.floor(lat / this.cell);
    const out = new Set();
    for (let x = gx - r; x <= gx + r; x++) for (let y = gy - r; y <= gy + r; y++) for (const i of this.grid.get(`${x},${y}`) || []) out.add(i);
    return out;
  }

  snap(lon, lat, { maxMeters = 60, level = null, usableOnly = false } = {}) {
    const { ef } = this;
    const k = Math.cos(lat * D2R);
    let best = null;
    for (const i of this.edgesNear(lon, lat, maxMeters)) {
      if (usableOnly && !this.usable[i]) continue;
      const e = this.edges[i];
      if (level != null && Math.abs(e[ef.level] - level) > 0.6 && !e[ef.connector]) continue;
      const cs = e[ef.coords];
      let along = 0;
      for (let j = 0; j < cs.length - 1; j++) {
        const ax = (cs[j][0] - lon) * k;
        const ay = cs[j][1] - lat;
        const bx = (cs[j + 1][0] - lon) * k;
        const by = cs[j + 1][1] - lat;
        const dx = bx - ax;
        const dy = by - ay;
        const L = dx * dx + dy * dy;
        let t = L ? -(ax * dx + ay * dy) / L : 0;
        t = Math.max(0, Math.min(1, t));
        const px = ax + t * dx;
        const py = ay + t * dy;
        const d = Math.sqrt(px * px + py * py) * MPD_LAT;
        const segLen = Math.sqrt(L) * MPD_LAT;
        if (d <= maxMeters && (!best || d < best.dist)) {
          best = { edge: i, dist: d, lon: lon + px / k, lat: lat + py, along: along + t * segLen };
        }
        along += segLen;
      }
    }
    if (best) {
      const e = this.edges[best.edge];
      const total = e[ef.len];
      const frac = total ? Math.min(1, best.along / this.polylineLength(e[ef.coords])) : 0;
      best.toA = frac * total;
      best.toB = (1 - frac) * total;
      best.level = e[ef.level];
    }
    return best;
  }

  polylineLength(cs) {
    let s = 0;
    for (let j = 0; j < cs.length - 1; j++) s += meters(cs[j], cs[j + 1]);
    return s || 1;
  }

  evaluate(date, ignoreTime) {
    const { ef, nf } = this;
    const ohState = this.ohStrings.map((_, i) => (ignoreTime ? true : this.ohOpen(i, date)));
    for (let i = 0; i < this.nodes.length; i++) {
      const oh = this.nodes[i][nf.oh];
      this.nodeOpen[i] = oh < 0 || ohState[oh] ? 1 : 0;
    }
    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i];
      this.usable[i] = ohState[e[ef.oh]] && this.nodeOpen[e[ef.a]] && this.nodeOpen[e[ef.b]] ? 1 : 0;
    }
    const parent = new Int32Array(this.nodes.length);
    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = (x) => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    for (let i = 0; i < this.edges.length; i++) {
      if (!this.usable[i]) continue;
      const e = this.edges[i];
      const ra = find(e[ef.a]);
      const rb = find(e[ef.b]);
      if (ra !== rb) parent[ra] = rb;
    }
    const surfaced = new Uint8Array(this.nodes.length);
    for (let i = 0; i < this.nodes.length; i++) {
      this.comp[i] = find(i);
      if ((this.nodes[i][nf.flags] & 1) && this.nodeOpen[i] && this.adj[i].some((ei) => this.usable[ei])) surfaced[this.comp[i]] = 1;
    }
    let openLen = 0;
    let reachLen = 0;
    let totalLen = 0;
    const changed = [];
    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i];
      const len = e[ef.len];
      totalLen += len;
      let st = 0;
      if (this.usable[i]) {
        openLen += len;
        st = surfaced[this.comp[e[ef.a]]] ? 2 : 1;
        if (st === 2) reachLen += len;
      }
      if (this.edgeState[i] !== st) {
        this.edgeState[i] = st;
        changed.push(i);
      }
    }
    this.surfaced = surfaced;
    this.version = (this.version || 0) + 1;
    return { changed, openLen, reachLen, totalLen };
  }

  entranceUsable(i) {
    const n = this.nodes[i];
    if (!this.nodeOpen[i]) return false;
    if (n[this.nf.flags] & 8) return true;
    return this.adj[i].some((e) => this.usable[e] && this.edgeState[e] === 2);
  }

  nearestEntrances(lon, lat, count = 3, maxMeters = 1500) {
    const out = [];
    for (const i of this.entrances) {
      const n = this.nodes[i];
      const d = meters([lon, lat], [n[0], n[1]]);
      if (d > maxMeters) continue;
      out.push({ index: i, dist: d, open: this.entranceUsable(i) });
    }
    out.sort((a, b) => (b.open - a.open) || a.dist - b.dist);
    const seen = new Set();
    const res = [];
    for (const o of out) {
      const n = this.nodes[o.index];
      const key = `${n[this.nf.station]}|${n[this.nf.ref]}`;
      if (n[this.nf.ref] && seen.has(key)) continue;
      seen.add(key);
      res.push(o);
      if (res.length >= count) break;
    }
    return res;
  }

  dijkstra(sources, opts = {}) {
    const { ef } = this;
    const n = this.nodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const heap = new Heap();
    for (const { node, cost } of sources) {
      if (cost < dist[node]) {
        dist[node] = cost;
        heap.push(cost, node);
      }
    }
    while (heap.size) {
      const [d, v] = heap.pop();
      if (d > dist[v]) continue;
      if (opts.target != null && v === opts.target) break;
      for (const ei of this.adj[v]) {
        if (!this.usable[ei]) continue;
        const e = this.edges[ei];
        if (opts.stepFree && e[ef.highway] === "steps") continue;
        const w = e[ef.a] === v ? e[ef.b] : e[ef.a];
        const nd = d + e[ef.len] * (e[ef.highway] === "steps" ? 1.5 : 1);
        if (nd < dist[w]) {
          dist[w] = nd;
          prev[w] = ei;
          heap.push(nd, w);
        }
      }
    }
    return { dist, prev };
  }

  pathTo(prev, target) {
    const { ef } = this;
    const segs = [];
    let v = target;
    let length = 0;
    for (let k = 0; k < this.nodes.length && prev[v] >= 0; k++) {
      const ei = prev[v];
      const e = this.edges[ei];
      let cs = e[ef.coords];
      if (e[ef.a] === v) cs = cs.slice().reverse();
      segs.unshift({ edge: ei, coords: cs });
      length += e[ef.len];
      v = e[ef.a] === v ? e[ef.b] : e[ef.a];
    }
    const line = [];
    for (const s of segs) for (const c of s.coords) {
      const l = line[line.length - 1];
      if (!l || l[0] !== c[0] || l[1] !== c[1]) line.push(c);
    }
    return { start: v, line, length, edges: segs.map((s) => s.edge) };
  }

  route(from, to, opts = {}) {
    const { dist, prev } = this.dijkstra([{ node: from, cost: 0 }], { ...opts, target: to });
    if (!isFinite(dist[to])) return null;
    return this.pathTo(prev, to);
  }

  plan(from, to, opts = {}) {
    const surfaceWeight = opts.preferUnderground === false ? 1.25 : 2.2;
    const detour = 1.25;
    const direct = meters(from, to) * detour;
    const maxAccess = Math.min(1500, Math.max(400, direct));
    const sources = [];
    const startSnap = opts.fromLevel != null && opts.fromLevel < 0 ? this.snap(from[0], from[1], { maxMeters: 40, level: opts.fromLevel, usableOnly: true }) : null;
    if (startSnap) {
      const e = this.edges[startSnap.edge];
      sources.push({ node: e[this.ef.a], cost: startSnap.toA, walk: 0 }, { node: e[this.ef.b], cost: startSnap.toB, walk: 0 });
    } else {
      for (const i of this.entrances) {
        if (!this.entranceUsable(i) || this.nodes[i][this.nf.flags] & 8) continue;
        const d = meters(from, [this.nodes[i][0], this.nodes[i][1]]) * detour;
        if (d <= maxAccess) sources.push({ node: i, cost: d * surfaceWeight, walk: d });
      }
      for (let i = 0; i < this.nodes.length; i++) {
        if (!(this.nodes[i][this.nf.flags] & 1) || this.nodes[i][this.nf.flags] & 2 || !this.nodeOpen[i]) continue;
        if (!this.adj[i].some((e) => this.usable[e])) continue;
        const d = meters(from, [this.nodes[i][0], this.nodes[i][1]]) * detour;
        if (d <= Math.min(maxAccess, 600)) sources.push({ node: i, cost: d * surfaceWeight, walk: d });
      }
    }
    if (!sources.length) return { direct, underground: null };
    const { dist, prev } = this.dijkstra(sources, opts);
    const walkOf = new Map(sources.map((s) => [s.node, s.walk]));
    let best = null;
    for (let i = 0; i < this.nodes.length; i++) {
      if (!isFinite(dist[i])) continue;
      const flags = this.nodes[i][this.nf.flags];
      if (!(flags & 1) || !this.nodeOpen[i]) continue;
      const d = meters([this.nodes[i][0], this.nodes[i][1]], to) * detour;
      if (d > maxAccess) continue;
      const total = dist[i] + d * surfaceWeight;
      if (!best || total < best.total) best = { exit: i, total, exitWalk: d };
    }
    if (!best) return { direct, underground: null };
    const path = this.pathTo(prev, best.exit);
    const entry = path.start;
    const entryWalk = walkOf.get(entry) ?? 0;
    const ug = path.length;
    if (ug < 30) return { direct, underground: null };
    return {
      direct,
      underground: {
        entry,
        exit: best.exit,
        line: path.line,
        edges: path.edges,
        undergroundMeters: ug,
        entryWalk,
        exitWalk: best.exitWalk,
        totalMeters: entryWalk + ug + best.exitWalk,
        fromSnap: startSnap,
      },
    };
  }
}
