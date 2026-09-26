import opening_hours from "opening_hours";

const NOMINATIM = { lat: 35.68, lon: 139.76, address: { country_code: "jp", state: "東京都" } };

export class Network {
  constructor(raw) {
    this.raw = raw;
    const ef = Object.fromEntries(raw.edge_fields.map((k, i) => [k, i]));
    const nf = Object.fromEntries(raw.node_fields.map((k, i) => [k, i]));
    this.ef = ef;
    this.nf = nf;
    this.nodes = raw.nodes;
    this.edges = raw.edges;
    this.ohStrings = raw.oh;
    this.notes = raw.notes;
    this.rules = Object.fromEntries((raw.rules || []).map((r) => [r.id, r]));
    this.oh = raw.oh.map((s) => {
      try {
        return new opening_hours(s, NOMINATIM, { mode: 0, warnings_severity: 0 });
      } catch (e) {
        return null;
      }
    });
    this.ph = new opening_hours("PH", NOMINATIM, { mode: 0 });
    this.adj = Array.from({ length: this.nodes.length }, () => []);
    this.edges.forEach((e, i) => {
      this.adj[e[ef.a]].push(i);
      this.adj[e[ef.b]].push(i);
    });
    this.edgeState = new Int8Array(this.edges.length).fill(-1);
    this.nodeOpen = new Uint8Array(this.nodes.length).fill(1);
    this.usable = new Uint8Array(this.edges.length);
    this.comp = new Int32Array(this.nodes.length);
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

  isHoliday(date) {
    return this.ph.getState(date);
  }

  ohOpen(idx, date) {
    const o = this.oh[idx];
    if (!o) return true;
    try {
      return o.getState(date);
    } catch (e) {
      return true;
    }
  }

  nextChange(idx, date) {
    const o = this.oh[idx];
    if (!o) return null;
    try {
      return o.getNextChange(date) || null;
    } catch (e) {
      return null;
    }
  }

  evaluate(date, ignoreTime) {
    const ohState = this.oh.map((_, i) => (ignoreTime ? true : this.ohOpen(i, date)));
    const { ef, nf } = this;
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
      if ((this.nodes[i][nf.flags] & 1) && this.nodeOpen[i]) {
        const touchesUsable = this.adj[i].some((ei) => this.usable[ei]);
        if (touchesUsable) surfaced[this.comp[i]] = 1;
      }
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
    return { changed, openLen, reachLen, totalLen };
  }

  nearestNode(lon, lat, predicate) {
    let best = -1;
    let bestD = Infinity;
    const k = Math.cos((lat * Math.PI) / 180);
    for (let i = 0; i < this.nodes.length; i++) {
      if (predicate && !predicate(i)) continue;
      const n = this.nodes[i];
      const dx = (n[0] - lon) * k;
      const dy = n[1] - lat;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { index: best, meters: Math.sqrt(bestD) * 111320 };
  }

  route(from, to, opts = {}) {
    const { ef } = this;
    const n = this.nodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const heap = [];
    const push = (d, v) => {
      heap.push([d, v]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    dist[from] = 0;
    push(0, from);
    while (heap.length) {
      const [d, v] = pop();
      if (d > dist[v]) continue;
      if (v === to) break;
      for (const ei of this.adj[v]) {
        if (!this.usable[ei]) continue;
        const e = this.edges[ei];
        if (opts.stepFree && e[ef.highway] === "steps") continue;
        const w = e[ef.a] === v ? e[ef.b] : e[ef.a];
        let cost = e[ef.len];
        if (e[ef.highway] === "steps") cost *= 1.5;
        const nd = d + cost;
        if (nd < dist[w]) {
          dist[w] = nd;
          prev[w] = ei;
          push(nd, w);
        }
      }
    }
    if (!isFinite(dist[to])) return null;
    const path = [];
    let v = to;
    let length = 0;
    while (v !== from) {
      const ei = prev[v];
      const e = this.edges[ei];
      let coords = e[ef.coords];
      if (e[ef.a] === v) coords = coords.slice().reverse();
      path.unshift(coords);
      length += e[ef.len];
      v = e[ef.a] === v ? e[ef.b] : e[ef.a];
    }
    const line = [];
    for (const seg of path) {
      for (const c of seg) {
        const last = line[line.length - 1];
        if (!last || last[0] !== c[0] || last[1] !== c[1]) line.push(c);
      }
    }
    return { line, length };
  }
}
