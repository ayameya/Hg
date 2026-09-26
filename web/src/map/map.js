import { decodeTile } from "./mvt.js";

const TILE = 512;
const LOCAL = 2 ** 24;
const D2R = Math.PI / 180;

export function lonLatToWorld(lon, lat) {
  const s = Math.sin(lat * D2R);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

export function worldToLonLat(x, y) {
  const lon = x * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return [lon, lat];
}

export function metersBetween(a, b) {
  const la = a[1] * D2R;
  const lb = b[1] * D2R;
  const h = Math.sin((lb - la) / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(((b[0] - a[0]) * D2R) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

export function bearing(a, b) {
  const la = a[1] * D2R;
  const lb = b[1] * D2R;
  const dl = (b[0] - a[0]) * D2R;
  const y = Math.sin(dl) * Math.cos(lb);
  const x = Math.cos(la) * Math.sin(lb) - Math.sin(la) * Math.cos(lb) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export class MapView {
  constructor(container, opts) {
    this.container = container;
    this.source = opts.source;
    this.style = opts.style;
    this.minZoom = opts.minZoom ?? 10;
    this.maxZoom = opts.maxZoom ?? 19;
    this.tileMaxZoom = opts.tileMaxZoom ?? 15;
    this.tileMinZoom = opts.tileMinZoom ?? 10;
    this.bounds = opts.bounds;
    const origin = lonLatToWorld(...(opts.origin || opts.center));
    this.origin = [origin[0] * LOCAL, origin[1] * LOCAL];
    this.canvas = document.createElement("canvas");
    this.canvas.className = "map-canvas";
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.center = lonLatToWorld(...opts.center);
    this.zoom = opts.zoom;
    this.tiles = new Map();
    this.overlays = [];
    this.listeners = {};
    this.hidden = new Set();
    this.pointers = new Map();
    this.frame = 0;
    this.labelHits = [];
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    this.bindEvents();
    this.readHash();
    window.addEventListener("hashchange", () => this.readHash());
  }

  on(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }

  emit(type, ev) {
    for (const fn of this.listeners[type] || []) fn(ev);
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.render();
  }

  get worldSize() {
    return TILE * 2 ** this.zoom;
  }

  toScreen(lon, lat) {
    const [x, y] = lonLatToWorld(lon, lat);
    return [(x - this.center[0]) * this.worldSize + this.w / 2, (y - this.center[1]) * this.worldSize + this.h / 2];
  }

  fromScreen(sx, sy) {
    const ws = this.worldSize;
    return worldToLonLat(this.center[0] + (sx - this.w / 2) / ws, this.center[1] + (sy - this.h / 2) / ws);
  }

  toLocal(lon, lat) {
    const [x, y] = lonLatToWorld(lon, lat);
    return [x * LOCAL - this.origin[0], y * LOCAL - this.origin[1]];
  }

  localTransform() {
    const s = this.worldSize / LOCAL;
    const ox = (this.origin[0] / LOCAL - this.center[0]) * this.worldSize + this.w / 2;
    const oy = (this.origin[1] / LOCAL - this.center[1]) * this.worldSize + this.h / 2;
    return { s, ox, oy };
  }

  getCenter() {
    return worldToLonLat(...this.center);
  }

  clamp() {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom));
    if (this.bounds) {
      const a = lonLatToWorld(this.bounds[0], this.bounds[3]);
      const b = lonLatToWorld(this.bounds[2], this.bounds[1]);
      this.center[0] = Math.max(a[0], Math.min(b[0], this.center[0]));
      this.center[1] = Math.max(a[1], Math.min(b[1], this.center[1]));
    }
  }

  setView(lonlat, zoom) {
    if (lonlat) this.center = lonLatToWorld(...lonlat);
    if (zoom != null) this.zoom = zoom;
    this.changed();
  }

  flyTo(lonlat, zoom, ms = 450) {
    const from = [...this.center];
    const fz = this.zoom;
    const to = lonLatToWorld(...lonlat);
    const tz = zoom ?? this.zoom;
    const t0 = performance.now();
    cancelAnimationFrame(this.anim);
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.center = [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e];
      this.zoom = fz + (tz - fz) * e;
      this.changed();
      if (k < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  zoomAround(sx, sy, dz) {
    const before = this.fromScreen(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom + dz));
    const [wx, wy] = lonLatToWorld(...before);
    this.center = [wx - (sx - this.w / 2) / this.worldSize, wy - (sy - this.h / 2) / this.worldSize];
    this.changed();
  }

  changed() {
    this.clamp();
    this.render();
    clearTimeout(this.hashTimer);
    this.hashTimer = setTimeout(() => this.writeHash(), 300);
    this.emit("move");
  }

  readHash() {
    const m = /map=([\d.]+)\/([\d.-]+)\/([\d.-]+)/.exec(location.hash);
    if (!m) return;
    this.zoom = Number(m[1]);
    this.center = lonLatToWorld(Number(m[3]), Number(m[2]));
    this.clamp();
    this.render();
  }

  writeHash() {
    const [lon, lat] = this.getCenter();
    const h = `#map=${this.zoom.toFixed(2)}/${lat.toFixed(5)}/${lon.toFixed(5)}`;
    if (location.hash !== h) history.replaceState(null, "", h);
  }

  bindEvents() {
    const c = this.canvas;
    c.style.touchAction = "none";
    let down = null;
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (this.pointers.size === 1) down = { x: e.offsetX, y: e.offsetY, t: performance.now(), moved: false };
      else down = null;
      this.pinch = null;
    });
    c.addEventListener("pointermove", (e) => {
      if (!this.pointers.has(e.pointerId)) {
        this.emit("hover", { x: e.offsetX, y: e.offsetY });
        return;
      }
      const prev = this.pointers.get(e.pointerId);
      this.pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (this.pointers.size === 1) {
        const dx = e.offsetX - prev[0];
        const dy = e.offsetY - prev[1];
        if (down && Math.hypot(e.offsetX - down.x, e.offsetY - down.y) > 4) down.moved = true;
        this.center = [this.center[0] - dx / this.worldSize, this.center[1] - dy / this.worldSize];
        this.changed();
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (this.pinch) {
          const dz = Math.log2(dist / this.pinch.dist);
          this.center = [this.center[0] - (mid[0] - this.pinch.mid[0]) / this.worldSize, this.center[1] - (mid[1] - this.pinch.mid[1]) / this.worldSize];
          this.zoomAround(mid[0], mid[1], dz);
        }
        this.pinch = { dist, mid };
      }
    });
    const up = (e) => {
      this.pointers.delete(e.pointerId);
      this.pinch = null;
      if (down && !down.moved && performance.now() - down.t < 600 && e.type === "pointerup") {
        const now = performance.now();
        if (this.lastTap && now - this.lastTap.t < 300 && Math.hypot(e.offsetX - this.lastTap.x, e.offsetY - this.lastTap.y) < 20) {
          this.lastTap = null;
          this.zoomAround(e.offsetX, e.offsetY, 1);
        } else {
          this.lastTap = { t: now, x: e.offsetX, y: e.offsetY };
          const pt = { x: e.offsetX, y: e.offsetY, lngLat: this.fromScreen(e.offsetX, e.offsetY) };
          setTimeout(() => {
            if (this.lastTap && this.lastTap.t === now) this.emit("click", pt);
          }, 250);
        }
      }
      down = null;
    };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const dz = -e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022);
      this.zoomAround(e.offsetX, e.offsetY, Math.max(-1, Math.min(1, dz)));
    }, { passive: false });
  }

  tileZoom() {
    return Math.max(this.tileMinZoom, Math.min(this.tileMaxZoom, Math.floor(this.zoom + 0.0001)));
  }

  visibleTiles() {
    const z = this.tileZoom();
    const n = 2 ** z;
    const ws = this.worldSize;
    const x0 = Math.floor((this.center[0] - this.w / 2 / ws) * n);
    const x1 = Math.floor((this.center[0] + this.w / 2 / ws) * n);
    const y0 = Math.floor((this.center[1] - this.h / 2 / ws) * n);
    const y1 = Math.floor((this.center[1] + this.h / 2 / ws) * n);
    const out = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
    const cx = (this.center[0] * n);
    const cy = (this.center[1] * n);
    out.sort((a, b) => Math.hypot(a[1] + 0.5 - cx, a[2] + 0.5 - cy) - Math.hypot(b[1] + 0.5 - cx, b[2] + 0.5 - cy));
    return out;
  }

  getTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    let t = this.tiles.get(key);
    if (!t) {
      t = { key, z, x, y, state: "loading", used: this.frame };
      this.tiles.set(key, t);
      this.source.tile(z, x, y).then((bytes) => {
        t.data = bytes ? this.style.prepare(decodeTile(bytes)) : null;
        t.state = "ready";
        this.render();
      }).catch(() => {
        t.state = "error";
      });
      this.prune();
    }
    t.used = this.frame;
    return t;
  }

  prune() {
    if (this.tiles.size < 160) return;
    const arr = [...this.tiles.values()].filter((t) => t.state !== "loading").sort((a, b) => a.used - b.used);
    for (const t of arr.slice(0, this.tiles.size - 120)) this.tiles.delete(t.key);
  }

  drawableTiles() {
    const list = [];
    const seen = new Set();
    for (const [z, x, y] of this.visibleTiles()) {
      const t = this.getTile(z, x, y);
      if (t.state === "ready") {
        if (t.data) list.push(t);
        continue;
      }
      for (let pz = z - 1, px = x >> 1, py = y >> 1; pz >= this.tileMinZoom; pz--, px >>= 1, py >>= 1) {
        const p = this.tiles.get(`${pz}/${px}/${py}`);
        if (p && p.state === "ready" && p.data) {
          if (!seen.has(p.key)) {
            seen.add(p.key);
            list.unshift(p);
          }
          p.used = this.frame;
          break;
        }
      }
    }
    return list;
  }

  render() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.draw();
    });
  }

  tileTransform(t) {
    const ws = this.worldSize;
    const n = 2 ** t.z;
    const ox = (t.x / n - this.center[0]) * ws + this.w / 2;
    const oy = (t.y / n - this.center[1]) * ws + this.h / 2;
    const s = ws / n / t.data.extent;
    return { s, ox, oy };
  }

  draw() {
    this.frame++;
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.style.background;
    ctx.fillRect(0, 0, this.w, this.h);
    const tiles = this.drawableTiles();
    const zoom = this.zoom;
    for (const layer of this.style.layers) {
      if (layer.minzoom && zoom < layer.minzoom) continue;
      if (layer.maxzoom && zoom >= layer.maxzoom) continue;
      if (layer.group && this.hidden.has(layer.group)) continue;
      for (const t of tiles) {
        const buckets = t.data.paths[layer.source];
        if (!buckets) continue;
        const { s, ox, oy } = this.tileTransform(t);
        ctx.save();
        const pad = 2 ** t.z === 2 ** this.tileZoom() ? 0 : 0;
        ctx.beginPath();
        ctx.rect(ox - pad, oy - pad, s * t.data.extent + pad * 2, s * t.data.extent + pad * 2);
        ctx.clip();
        ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
        for (const [bk, path] of buckets) {
          const st = layer.paint(bk, zoom);
          if (!st) continue;
          if (st.fill) {
            ctx.fillStyle = st.fill;
            ctx.fill(path);
          }
          if (st.stroke) {
            ctx.strokeStyle = st.stroke;
            ctx.lineWidth = st.width / s;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.setLineDash(st.dash ? st.dash.map((d) => d / s) : []);
            ctx.stroke(path);
          }
        }
        ctx.restore();
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.setLineDash([]);
    for (const o of this.overlays) o.draw?.(ctx, this);
    this.drawLabels(tiles);
    for (const o of this.overlays) o.drawTop?.(ctx, this);
    this.emit("render");
  }

  drawLabels(tiles) {
    const ctx = this.ctx;
    const cands = [];
    for (const o of this.overlays) o.labels?.(this, cands);
    for (const t of tiles) {
      const { s, ox, oy } = this.tileTransform(t);
      for (const p of t.data.points) {
        const rule = this.style.point(p, this.zoom, this.hidden);
        if (!rule) continue;
        cands.push({ x: ox + p.x * s, y: oy + p.y * s, ...rule, feature: p });
      }
    }
    cands.sort((a, b) => a.priority - b.priority);
    const placed = [];
    const hits = [];
    const collide = (r) => {
      for (const q of placed) if (r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) return true;
      return false;
    };
    ctx.textBaseline = "middle";
    for (const c of cands) {
      if (c.x < -50 || c.y < -50 || c.x > this.w + 50 || c.y > this.h + 50) continue;
      const r = c.radius || 0;
      const iconBox = [c.x - r - 1, c.y - r - 1, c.x + r + 1, c.y + r + 1];
      if (!c.force && r && collide(iconBox)) continue;
      let textBox = null;
      if (c.text) {
        ctx.font = c.font;
        const tw = ctx.measureText(c.text).width;
        const th = c.size || 12;
        const tx = r ? c.x + r + 3 : c.x - tw / 2;
        textBox = [tx - 2, c.y - th / 2 - 1, tx + tw + 2, c.y + th / 2 + 1];
        if (collide(textBox)) {
          if (!r || c.textRequired) continue;
          textBox = null;
        }
      }
      if (r) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fillStyle = c.color;
        ctx.fill();
        if (c.ring) {
          ctx.lineWidth = c.ringWidth || 1.5;
          ctx.strokeStyle = c.ring;
          ctx.stroke();
        }
        if (c.glyph) {
          ctx.fillStyle = c.glyphColor || "#fff";
          ctx.font = `700 ${Math.round(r * 1.3)}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(c.glyph, c.x, c.y + 0.5);
          ctx.textAlign = "left";
        }
        placed.push(iconBox);
      }
      if (textBox) {
        ctx.font = c.font;
        ctx.lineWidth = 3;
        ctx.strokeStyle = c.halo || "rgba(255,255,255,0.92)";
        ctx.lineJoin = "round";
        ctx.strokeText(c.text, textBox[0] + 2, c.y);
        ctx.fillStyle = c.textColor || "#222";
        ctx.fillText(c.text, textBox[0] + 2, c.y);
        placed.push(textBox);
      }
      if (c.feature) hits.push({ box: textBox ? [Math.min(iconBox[0], textBox[0]), Math.min(iconBox[1], textBox[1]), Math.max(iconBox[2], textBox[2]), Math.max(iconBox[3], textBox[3])] : iconBox, c });
    }
    this.labelHits = hits;
  }

  pickLabel(x, y) {
    for (let i = this.labelHits.length - 1; i >= 0; i--) {
      const h = this.labelHits[i];
      const b = h.box;
      if (x >= b[0] - 4 && x <= b[2] + 4 && y >= b[1] - 4 && y <= b[3] + 4) return h.c;
    }
    return null;
  }
}
