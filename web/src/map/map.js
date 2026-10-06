import { Renderer } from "../gl/renderer.js";

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

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i];
    const yi = ring[i + 1];
    const xj = ring[j];
    const yj = ring[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ringDistance(x, y, ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[j];
    const ay = ring[j + 1];
    const dx = ring[i] - ax;
    const dy = ring[i + 1] - ay;
    const L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

export class MapView {
  constructor(container, opts) {
    this.container = container;
    this.style = opts.style;
    this.layers = opts.layers;
    this.minZoom = opts.minZoom ?? 10;
    this.maxZoom = opts.maxZoom ?? 19;
    this.tileMaxZoom = opts.tileMaxZoom ?? 15;
    this.tileMinZoom = opts.tileMinZoom ?? 10;
    this.bounds = opts.bounds;
    const origin = lonLatToWorld(...(opts.origin || opts.center));
    this.origin = [origin[0] * LOCAL, origin[1] * LOCAL];
    this.canvas = document.createElement("canvas");
    this.canvas.className = "map-canvas";
    this.labelCanvas = document.createElement("canvas");
    this.labelCanvas.className = "map-labels";
    container.appendChild(this.canvas);
    container.appendChild(this.labelCanvas);
    this.gl = new Renderer(this.canvas);
    this.ctx = this.labelCanvas.getContext("2d");
    this.center = lonLatToWorld(...opts.center);
    this.zoom = opts.zoom;
    this.tiles = new Map();
    this.pending = new Map();
    this.uploads = [];
    this.overlays = [];
    this.listeners = {};
    this.hidden = new Set();
    this.pointers = new Map();
    this.frame = 0;
    this.labelHits = [];
    this.textWidths = new Map();
    this.sprites = new Map();
    this.stats = { frames: 0, frameMs: 0, maxFrameMs: 0, tilesLoaded: 0, uploadMs: 0, workerMs: 0 };
    this.nextId = 1;
    const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    this.workers = Array.from({ length: n }, () => {
      const w = new Worker(opts.workerUrl);
      w.postMessage({ type: "init", url: opts.tilesUrl, parts: opts.tileParts || null });
      w.onmessage = (ev) => this.onWorker(ev.data);
      return w;
    });
    this.rr = 0;
    this.webgl2 = this.gl.webgl2;
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.sprites && dpr !== this.dpr) this.sprites.clear();
    this.dpr = dpr;
    this.w = r.width;
    this.h = r.height;
    for (const c of [this.canvas, this.labelCanvas]) {
      c.width = Math.max(1, Math.round(r.width * this.dpr));
      c.height = Math.max(1, Math.round(r.height * this.dpr));
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
    }
    this.gl.resize(this.w, this.h, this.dpr);
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
    if (location.hash === h) return;
    try {
      history.replaceState(null, "", h);
    } catch (e) {
      return;
    }
  }

  bindEvents() {
    const c = this.labelCanvas;
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
      this.lastWheel = performance.now();
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
    const cx = this.center[0] * n;
    const cy = this.center[1] * n;
    out.sort((a, b) => Math.hypot(a[1] + 0.5 - cx, a[2] + 0.5 - cy) - Math.hypot(b[1] + 0.5 - cx, b[2] + 0.5 - cy));
    return out;
  }

  request(z, x, y) {
    const key = `${z}/${x}/${y}`;
    let t = this.tiles.get(key);
    if (!t) {
      const id = this.nextId++;
      t = { key, z, x, y, id, state: "loading", used: this.frame };
      this.tiles.set(key, t);
      this.pending.set(id, t);
      const w = this.workers[this.rr++ % this.workers.length];
      t.worker = w;
      w.postMessage({ type: "tile", id, z, x, y });
    }
    t.used = this.frame;
    return t;
  }

  onWorker(m) {
    if (m.type !== "tile") return;
    const t = this.pending.get(m.id);
    this.pending.delete(m.id);
    if (!t || this.tiles.get(t.key) !== t) return;
    if (m.cancelled) {
      this.tiles.delete(t.key);
      return;
    }
    if (m.error || !m.data) {
      t.state = m.error ? "error" : "empty";
      t.data = null;
      this.render();
      return;
    }
    this.stats.workerMs += m.data.buildMs || 0;
    this.uploads.push([t, m.data]);
    this.render();
  }

  processUploads() {
    const t0 = performance.now();
    while (this.uploads.length && performance.now() - t0 < 6) {
      const [t, data] = this.uploads.shift();
      if (this.tiles.get(t.key) !== t) continue;
      t.gpu = this.gl.upload(data);
      t.data = { extent: data.extent, points: data.points, picks: data.picks };
      t.state = "ready";
      this.stats.tilesLoaded++;
    }
    this.stats.uploadMs += performance.now() - t0;
    if (this.uploads.length) this.render();
  }

  prune(visible) {
    for (const t of this.tiles.values()) {
      if (t.state === "loading" && !visible.has(t.key) && this.frame - t.used > 2) {
        t.worker.postMessage({ type: "cancel", id: t.id });
      }
    }
    if (this.tiles.size < 220) return;
    const arr = [...this.tiles.values()].filter((t) => t.state !== "loading" && !visible.has(t.key)).sort((a, b) => a.used - b.used);
    for (const t of arr.slice(0, this.tiles.size - 160)) {
      this.gl.release(t.gpu);
      this.tiles.delete(t.key);
    }
  }

  slots() {
    const list = [];
    const visible = new Set();
    const ws = this.worldSize;
    for (const [z, x, y] of this.visibleTiles()) {
      const t = this.request(z, x, y);
      visible.add(t.key);
      const n = 2 ** z;
      const clip = [(x / n - this.center[0]) * ws + this.w / 2, (y / n - this.center[1]) * ws + this.h / 2, ((x + 1) / n - this.center[0]) * ws + this.w / 2, ((y + 1) / n - this.center[1]) * ws + this.h / 2];
      if (t.state === "ready") {
        list.push({ tile: t, clip });
        continue;
      }
      if (t.state === "empty" || t.state === "error") continue;
      let found = false;
      for (let pz = z - 1, px = x >> 1, py = y >> 1; pz >= this.tileMinZoom; pz--, px >>= 1, py >>= 1) {
        const p = this.tiles.get(`${pz}/${px}/${py}`);
        if (p && p.state === "ready") {
          p.used = this.frame;
          visible.add(p.key);
          list.unshift({ tile: p, clip });
          found = true;
          break;
        }
      }
      if (!found && z + 1 <= this.tileMaxZoom) {
        for (const [cx, cy] of [[2 * x, 2 * y], [2 * x + 1, 2 * y], [2 * x, 2 * y + 1], [2 * x + 1, 2 * y + 1]]) {
          const c = this.tiles.get(`${z + 1}/${cx}/${cy}`);
          if (c && c.state === "ready") {
            c.used = this.frame;
            visible.add(c.key);
            list.unshift({ tile: c, clip });
          }
        }
      }
    }
    this.prune(visible);
    return list;
  }

  render() {
    if (this.pendingFrame) return;
    this.pendingFrame = true;
    requestAnimationFrame(() => {
      this.pendingFrame = false;
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
    const t0 = performance.now();
    this.frame++;
    this.processUploads();
    const gl = this.gl;
    gl.begin(this.style.background);
    const slots = this.slots();
    const zoom = this.zoom;
    const prepared = slots.map((sl) => {
      const { s, ox, oy } = this.tileTransform(sl.tile);
      return { ...sl, s, tf: gl.tf(s, ox, oy) };
    });
    for (const layer of this.layers) {
      if (layer.minzoom && zoom < layer.minzoom) continue;
      if (layer.maxzoom && zoom >= layer.maxzoom) continue;
      if (layer.group && this.hidden.has(layer.group)) continue;
      for (const sl of prepared) {
        const ranges = sl.tile.gpu.ranges[layer.id];
        if (!ranges) continue;
        gl.scissor(sl.clip);
        for (const r of ranges) {
          const paint = layer.paint(r.key, zoom);
          if (!paint) continue;
          if (r.kind === "fill") {
            if ((paint.opacity ?? 1) <= 0) continue;
            gl.drawFill(sl.tile.gpu, r, sl.tf, paint.color, paint.opacity ?? 1);
            if (paint.outline) gl.drawOutline(sl.tile.gpu, r, sl.tf, paint.outline, paint.opacity ?? 1);
          } else {
            gl.drawLine(sl.tile.gpu, r, sl.tf, sl.s, paint);
          }
        }
      }
    }
    gl.scissor(null);
    for (const o of this.overlays) o.gl?.(gl, this);
    this.stats.glMs = performance.now() - t0;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    for (const o of this.overlays) o.draw?.(ctx, this);
    const tl = performance.now();
    this.drawLabels(slots);
    this.stats.labelMs = performance.now() - tl;
    for (const o of this.overlays) o.drawTop?.(ctx, this);
    this.lastSlots = slots;
    const dt = performance.now() - t0;
    this.stats.frames++;
    this.stats.frameMs = dt;
    this.stats.maxFrameMs = Math.max(this.stats.maxFrameMs, dt);
    this.stats.draws = gl.stats.draws;
    this.stats.triangles = gl.stats.triangles;
    this.stats.tiles = slots.length;
    this.emit("render");
  }

  pickBuilding(x, y) {
    if (!this.lastSlots) return null;
    for (const sl of this.lastSlots) {
      const c = sl.clip;
      if (x < c[0] || x > c[2] || y < c[1] || y > c[3]) continue;
      const t = sl.tile;
      if (!t.data || !t.data.picks) continue;
      const { s, ox, oy } = this.tileTransform(t);
      const ux = (x - ox) / s;
      const uy = (y - oy) / s;
      const tol = 6 / s;
      let near = null;
      let nearD = tol;
      for (const p of t.data.picks) {
        if (pointInRing(ux, uy, p.ring)) return { props: p.props, lngLat: this.fromScreen(ox + p.c[0] * s, oy + p.c[1] * s) };
        const d = ringDistance(ux, uy, p.ring);
        if (d < nearD) {
          nearD = d;
          near = p;
        }
      }
      if (near) return { props: near.props, lngLat: this.fromScreen(ox + near.c[0] * s, oy + near.c[1] * s) };
    }
    return null;
  }

  measure(ctx, font, text) {
    let m = this.textWidths.get(font);
    if (!m) this.textWidths.set(font, (m = new Map()));
    let w = m.get(text);
    if (w == null) {
      ctx.font = font;
      w = ctx.measureText(text).width;
      if (m.size > 20000) m.clear();
      m.set(text, w);
    }
    return w;
  }

  sprite(kind, key, w, h, paint) {
    const full = kind + key;
    let sp = this.sprites.get(full);
    if (sp) return sp;
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * this.dpr);
    c.height = Math.ceil(h * this.dpr);
    const x = c.getContext("2d");
    x.scale(this.dpr, this.dpr);
    paint(x);
    sp = { c, w, h };
    this.sprites.set(full, sp);
    if (this.sprites.size > 4000) this.sprites.clear();
    return sp;
  }

  textSprite(c, tw, th) {
    const key = (c.textKey || `${c.font}|${c.textColor}|${c.halo}|`) + c.text;
    return this.sprite("t", key, tw + 4, th + 4, (x) => {
      x.font = c.font;
      x.textBaseline = "middle";
      x.lineWidth = 3;
      x.lineJoin = "round";
      x.strokeStyle = c.halo || "rgba(255,255,255,0.92)";
      x.strokeText(c.text, 2, (th + 4) / 2);
      x.fillStyle = c.textColor || "#222";
      x.fillText(c.text, 2, (th + 4) / 2);
    });
  }

  iconSprite(c) {
    const r = c.radius;
    const pad = (c.ringWidth || 1.5) + 1;
    const size = 2 * (r + pad);
    const key = c.iconKey || `${r}|${c.color}|${c.ring}|${c.ringWidth}|${c.glyph}|${c.glyphColor}`;
    return this.sprite("i", key, size, size, (x) => {
      x.beginPath();
      x.arc(size / 2, size / 2, r, 0, Math.PI * 2);
      x.fillStyle = c.color;
      x.fill();
      if (c.ring) {
        x.lineWidth = c.ringWidth || 1.5;
        x.strokeStyle = c.ring;
        x.stroke();
      }
      if (c.glyph) {
        x.fillStyle = c.glyphColor || "#fff";
        x.font = `700 ${Math.round(r * 1.3)}px system-ui, sans-serif`;
        x.textAlign = "center";
        x.textBaseline = "middle";
        x.fillText(c.glyph, size / 2, size / 2 + 0.5);
      }
    });
  }

  drawLabels(slots) {
    const ctx = this.ctx;
    const cands = [];
    for (const o of this.overlays) o.labels?.(this, cands);
    const seen = new Set();
    for (const slot of slots) {
      const t = slot.tile;
      if (seen.has(t)) continue;
      seen.add(t);
      const { s, ox, oy } = this.tileTransform(t);
      for (const p of t.data.points) {
        const x = ox + p.x * s;
        const y = oy + p.y * s;
        if (x < -60 || y < -30 || x > this.w + 60 || y > this.h + 30) continue;
        const rule = this.style.point(p, this.zoom, this.hidden);
        if (!rule) continue;
        rule.x = x;
        rule.y = y;
        rule.feature = p;
        cands.push(rule);
      }
    }
    cands.sort((a, b) => a.priority - b.priority);
    const CELL = 64;
    const cols = Math.ceil(this.w / CELL) + 2;
    const grid = new Map();
    const collide = (r) => {
      const x0 = Math.floor(r[0] / CELL);
      const x1 = Math.floor(r[2] / CELL);
      const y0 = Math.floor(r[1] / CELL);
      const y1 = Math.floor(r[3] / CELL);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gy = y0; gy <= y1; gy++) {
          const list = grid.get(gy * cols + gx);
          if (!list) continue;
          for (const q of list) if (r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) return true;
        }
      }
      return false;
    };
    const place = (r) => {
      const x0 = Math.floor(r[0] / CELL);
      const x1 = Math.floor(r[2] / CELL);
      const y0 = Math.floor(r[1] / CELL);
      const y1 = Math.floor(r[3] / CELL);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gy = y0; gy <= y1; gy++) {
          const k = gy * cols + gx;
          let list = grid.get(k);
          if (!list) grid.set(k, (list = []));
          list.push(r);
        }
      }
    };
    const hits = [];
    for (const c of cands) {
      if (c.x < -50 || c.y < -50 || c.x > this.w + 50 || c.y > this.h + 50) continue;
      const r = c.radius || 0;
      const iconBox = [c.x - r - 1, c.y - r - 1, c.x + r + 1, c.y + r + 1];
      if (!c.force && r && collide(iconBox)) continue;
      let textBox = null;
      let tw = 0;
      const th = c.size || 12;
      if (c.text) {
        tw = this.measure(ctx, c.font, c.text);
        const tx = r ? c.x + r + 3 : c.x - tw / 2;
        textBox = [tx - 2, c.y - th / 2 - 1, tx + tw + 2, c.y + th / 2 + 1];
        if (collide(textBox)) {
          if (!r || c.textRequired) continue;
          textBox = null;
        }
      }
      if (r) {
        const sp = this.iconSprite(c);
        ctx.drawImage(sp.c, c.x - sp.w / 2, c.y - sp.h / 2, sp.w, sp.h);
        place(iconBox);
      }
      if (textBox) {
        const sp = this.textSprite(c, tw, th);
        ctx.drawImage(sp.c, textBox[0], c.y - sp.h / 2, sp.w, sp.h);
        place(textBox);
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
