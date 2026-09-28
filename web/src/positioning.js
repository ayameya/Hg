import { Barometer, GraphParticleFilter } from "./pdr/filter.js";
import { HeadingFusion, MotionProcessor, yawRate } from "./pdr/motion.js";
import { Recorder, mergeEvents } from "./pdr/recorder.js";

const EXTERNAL_PRIORITY_MS = 15000;
const FIX_FRESH_MS = 3000;
const STORE = "ugmap.pdr";

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "{}");
  } catch (e) {
    return {};
  }
}

function saveStore(v) {
  try {
    localStorage.setItem(STORE, JSON.stringify(v));
  } catch (e) {
    return;
  }
}

export class Positioning {
  constructor(net) {
    this.net = net;
    this.raw = null;
    this.snapped = null;
    this.heading = null;
    this.listeners = new Set();
    this.lastExternal = 0;
    this.gpsWatch = null;
    this.store = loadStore();
    this.motion = new MotionProcessor({ height: this.store.height || 1.65, model: this.store.model });
    this.fusion = new HeadingFusion();
    this.filter = new GraphParticleFilter(net);
    this.baro = new Barometer();
    this.pdr = { enabled: false, steps: 0, activity: "still", confidence: 0, lastLength: 0, events: [] };
    this.recorder = null;
    this.onOrientation = this.onOrientation.bind(this);
    this.onMotion = this.onMotion.bind(this);
    this.motion.on((e) => this.onMotionEvent(e));
    this.baro.on((e) => this.onMotionEvent(e));
    window.addEventListener("message", (ev) => {
      const d = ev.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "ugmap:position") this.setPosition({ source: "message", ...d });
      if (d.type === "ugmap:clear") this.clear();
      if (d.type === "ugmap:motion") this.pushMotion(d);
      if (d.type === "ugmap:pressure") this.pushPressure(d.hPa, d.t);
      if (d.type === "ugmap:step") this.pushStep(d);
      if (d.type === "ugmap:event") this.pushEvent(d);
    });
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    if (this.emitPending) return;
    this.emitPending = true;
    queueMicrotask(() => {
      this.emitPending = false;
      for (const fn of this.listeners) fn(this);
    });
  }

  get height() {
    return this.motion.height;
  }

  setHeight(m) {
    if (!(m > 1 && m < 2.3)) return;
    this.motion.height = m;
    this.store.height = m;
    saveStore(this.store);
  }

  setModel(model) {
    this.motion.setModel(model);
    if (model) this.store.model = model;
    else delete this.store.model;
    saveStore(this.store);
  }

  setPosition(p) {
    const lat = Number(p.lat);
    const lon = Number(p.lon ?? p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("lat/lon are required");
    const source = p.source || "external";
    const now = Date.now();
    if (source !== "gps") this.lastExternal = now;
    else if (now - this.lastExternal < EXTERNAL_PRIORITY_MS) return null;
    const level = p.level == null || p.level === "" ? null : Number(p.level);
    const accuracy = Number.isFinite(Number(p.accuracy)) ? Number(p.accuracy) : null;
    if (source === "gps" && this.filter.active && this.estimateCache?.level < 0 && (accuracy == null || accuracy > 15)) return null;
    this.raw = { lat, lon, level, accuracy, source, time: p.timestamp ? new Date(p.timestamp) : new Date(), received: this.replaying ? 0 : now };
    if (Number.isFinite(Number(p.heading)) && source !== "gps") {
      this.fusion.set(Number(p.heading));
      this.heading = Number(p.heading);
    }
    const radius = Math.max(8, Math.min(60, (accuracy ?? 10) * 1.5));
    this.snapped = level != null && level < 0 ? this.net.snap(lon, lat, { maxMeters: radius, level }) : level === 0 ? null : this.net.snap(lon, lat, { maxMeters: Math.min(radius, 12) });
    if (this.snapped && level == null && this.snapped.level < 0 && source === "gps") this.snapped = null;
    const fixLevel = level ?? (this.snapped ? this.snapped.level : null);
    if (level === 0 || (source === "gps" && !this.snapped)) this.filter.active = false;
    else this.filter.fix(lon, lat, accuracy ?? 10, fixLevel);
    this.filter.free = { lon, lat, level: fixLevel };
    this.recorder?.fix(performance.now(), { lat, lon, level, accuracy, source });
    this.updateEstimate();
    this.emit();
    return this.snapped ? { lat: this.snapped.lat, lon: this.snapped.lon, level: this.snapped.level, edge: this.snapped.edge, offsetMeters: this.snapped.dist } : null;
  }

  clear() {
    this.raw = null;
    this.snapped = null;
    this.filter.active = false;
    this.filter.free = null;
    this.estimateCache = null;
    this.emit();
  }

  updateEstimate() {
    this.estimateCache = this.filter.active || this.filter.free ? this.filter.estimate() : null;
  }

  get position() {
    const now = Date.now();
    const fresh = this.raw && !this.replaying && now - this.raw.received < FIX_FRESH_MS;
    const est = this.estimateCache;
    if ((this.pdr.enabled || this.pdr.replayed) && est && !fresh && this.pdr.steps > 0) {
      return { lon: est.lon, lat: est.lat, level: est.level ?? null, accuracy: est.spread, source: est.mode === "network" ? "pdr" : "pdr-free" };
    }
    if (!this.raw) return est ? { lon: est.lon, lat: est.lat, level: est.level ?? null, accuracy: est.spread, source: "pdr" } : null;
    if (this.snapped) return { lon: this.snapped.lon, lat: this.snapped.lat, level: this.snapped.level, accuracy: this.raw.accuracy, source: this.raw.source };
    return { lon: this.raw.lon, lat: this.raw.lat, level: this.raw.level, accuracy: this.raw.accuracy, source: this.raw.source };
  }

  startGps() {
    if (!navigator.geolocation || this.gpsWatch != null) return;
    this.gpsWatch = navigator.geolocation.watchPosition(
      (pos) => {
        this.setPosition({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy, heading: pos.coords.heading, source: "gps", timestamp: pos.timestamp });
      },
      (err) => {
        this.error = err.message;
        this.emit();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }

  async requestPermission(Klass) {
    if (!Klass) return false;
    try {
      if (typeof Klass.requestPermission === "function") return (await Klass.requestPermission()) === "granted";
    } catch (e) {
      return false;
    }
    return true;
  }

  async startCompass() {
    if (!(await this.requestPermission(window.DeviceOrientationEvent))) return false;
    window.addEventListener("deviceorientationabsolute", this.onOrientation);
    window.addEventListener("deviceorientation", this.onOrientation);
    return true;
  }

  async startPdr() {
    const ok = await this.requestPermission(window.DeviceMotionEvent);
    await this.startCompass();
    if (!ok || !window.DeviceMotionEvent) {
      this.pdr.error = "この端末ではモーションセンサーを使えません";
      this.emit();
      return false;
    }
    window.addEventListener("devicemotion", this.onMotion);
    this.pdr.enabled = true;
    this.emit();
    return true;
  }

  stopPdr() {
    window.removeEventListener("devicemotion", this.onMotion);
    this.pdr.enabled = false;
    this.emit();
  }

  onOrientation(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === "number") h = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === "number") h = (360 - e.alpha) % 360;
    else return;
    const scr = (screen.orientation && screen.orientation.angle) || 0;
    h = (h + scr + 360) % 360;
    this.lastCompass = h;
    this.fusion.compass(h);
    const next = this.fusion.heading ?? h;
    if (this.heading == null || Math.abs(((next - this.heading + 540) % 360) - 180) > 2) {
      this.heading = next;
      this.emit();
    }
  }

  onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const r = e.rotationRate || {};
    this.pushMotion({ t: e.timeStamp || performance.now(), ax: a.x, ay: a.y, az: a.z, alpha: r.alpha, beta: r.beta, gamma: r.gamma, interval: e.interval });
  }

  pushMotion(d) {
    const t = Number(d.t ?? performance.now());
    const prev = this.lastMotionT;
    this.lastMotionT = t;
    this.motion.push(t, Number(d.ax), Number(d.ay), Number(d.az));
    if (prev != null && this.motion.grav && (d.alpha != null || d.beta != null || d.gamma != null)) {
      const dt = Math.min(0.1, Math.max(0, (t - prev) / 1000));
      this.fusion.gyro(dt, yawRate(this.motion.grav, { alpha: Number(d.alpha) || 0, beta: Number(d.beta) || 0, gamma: Number(d.gamma) || 0 }));
      if (this.fusion.heading != null) this.heading = this.fusion.heading;
    }
    this.recorder?.sample(t, d.ax, d.ay, d.az, d.alpha, d.beta, d.gamma, this.lastCompass);
  }

  pushPressure(hPa, t = performance.now()) {
    this.baro.push(Number(t), Number(hPa));
    this.recorder?.pressure(t, hPa);
  }

  pushStep(d) {
    this.onMotionEvent({ type: "step", t: performance.now(), length: Number(d.length) || 0.7, activity: d.activity || "walk", confidence: Number(d.confidence) || 0, external: true, heading: d.heading });
  }

  pushEvent(d) {
    if (d.kind === "floor" || d.event === "floor") this.onMotionEvent({ type: "floor", dz: Number(d.dz) });
    if (d.kind === "stairs" || d.event === "stairs") this.onMotionEvent({ type: "activity", activity: d.direction === "down" ? "down" : "up", confidence: Number(d.confidence) || 0.8 });
  }

  onMotionEvent(e) {
    const p = this.pdr;
    if (e.type === "step") {
      p.steps += 1;
      p.lastLength = e.length;
      p.activity = e.activity;
      p.confidence = e.confidence;
      const heading = e.heading != null ? Number(e.heading) : this.heading;
      if (this.filter.active || this.filter.free) {
        this.filter.step(e.length, heading);
        if ((e.activity === "up" || e.activity === "down") && e.confidence > 0.25) this.filter.stairs(e.confidence);
      }
    } else if (e.type === "activity") {
      p.activity = e.activity;
      p.confidence = e.confidence;
      if ((e.activity === "up" || e.activity === "down") && this.filter.active) this.filter.stairs(e.confidence);
    } else if (e.type === "elevator" || e.type === "floor") {
      p.events.unshift({ type: e.type, dz: e.dz, time: new Date() });
      p.events.length = Math.min(p.events.length, 5);
      this.filter.levelChange(e.dz);
    }
    if (e.type !== "step" || p.steps % 2 === 0 || e.external) {
      this.updateEstimate();
      this.emit();
    }
    this.recorder?.event(e.t ?? performance.now(), { type: e.type, length: e.length, activity: e.activity, confidence: e.confidence, dz: e.dz });
  }

  startRecording() {
    this.recorder = new Recorder({ height: this.height });
    this.emit();
  }

  stopRecording() {
    const log = this.recorder ? this.recorder.log : null;
    this.recorder = null;
    this.emit();
    return log;
  }

  label(name) {
    this.recorder?.label(performance.now(), name);
  }

  replay(log, { onProgress, speed = 60 } = {}) {
    const events = mergeEvents(log);
    const wasEnabled = this.pdr.enabled;
    this.pdr.enabled = true;
    this.pdr.steps = 0;
    this.replaying = true;
    let i = 0;
    return new Promise((resolve) => {
      const tick = () => {
        if (!events.length) {
          this.replaying = false;
          this.pdr.enabled = wasEnabled;
          return resolve();
        }
        const t0 = events[i] ? events[i][0] : 0;
        const until = t0 + (1000 * speed) / 60;
        while (i < events.length && events[i][0] <= until) {
          const [, kind, v] = events[i++];
          if (kind === "m") {
            if (v[7] != null) {
              this.lastCompass = v[7];
              this.fusion.compass(v[7]);
            }
            this.pushMotion({ t: v[0], ax: v[1], ay: v[2], az: v[3], alpha: v[4], beta: v[5], gamma: v[6] });
          }
          if (kind === "f") this.setPosition({ lat: v[1], lon: v[2], level: v[3], accuracy: v[4], source: `replay:${v[5] || "fix"}` });
          if (kind === "p") this.pushPressure(v[1], v[0]);
        }
        onProgress?.(i / events.length);
        this.updateEstimate();
        this.emit();
        if (i < events.length) requestAnimationFrame(tick);
        else {
          this.replaying = false;
          this.pdr.enabled = wasEnabled;
          this.pdr.replayed = true;
          this.emit();
          resolve();
        }
      };
      tick();
    });
  }

  exportAnchors() {
    const { nf } = this.net;
    const rows = [["node_index", "osm_node_id", "lat", "lon", "level", "kind", "station", "ref"]];
    this.net.nodes.forEach((n, i) => {
      const flags = n[nf.flags];
      const kind = flags & 4 ? "elevator" : flags & 2 ? "entrance" : flags & 1 ? "surface_link" : this.net.adj[i].length > 2 ? "junction" : this.net.adj[i].length === 1 ? "end" : "";
      if (!kind) return;
      rows.push([i, n[nf.osm_id], n[1], n[0], this.net.nodeLevel[i], kind, n[nf.station] || "", n[nf.ref] || ""]);
    });
    return rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",")).join("\n");
  }
}
