const EXTERNAL_PRIORITY_MS = 15000;

export class Positioning {
  constructor(net) {
    this.net = net;
    this.raw = null;
    this.snapped = null;
    this.heading = null;
    this.listeners = new Set();
    this.lastExternal = 0;
    this.gpsWatch = null;
    this.onOrientation = this.onOrientation.bind(this);
    window.addEventListener("message", (ev) => {
      const d = ev.data;
      if (d && typeof d === "object" && d.type === "ugmap:position") this.setPosition({ source: "message", ...d });
      if (d && typeof d === "object" && d.type === "ugmap:clear") this.clear();
    });
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  setPosition(p) {
    const lat = Number(p.lat);
    const lon = Number(p.lon ?? p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("lat/lon are required");
    const source = p.source || "external";
    if (source !== "gps") this.lastExternal = Date.now();
    else if (Date.now() - this.lastExternal < EXTERNAL_PRIORITY_MS) return null;
    const level = p.level == null || p.level === "" ? null : Number(p.level);
    const accuracy = Number.isFinite(Number(p.accuracy)) ? Number(p.accuracy) : null;
    this.raw = { lat, lon, level, accuracy, source, time: p.timestamp ? new Date(p.timestamp) : new Date() };
    if (Number.isFinite(Number(p.heading))) this.heading = Number(p.heading);
    const radius = Math.max(8, Math.min(60, (accuracy ?? 10) * 1.5));
    this.snapped = level != null && level < 0 ? this.net.snap(lon, lat, { maxMeters: radius, level }) : level === 0 ? null : this.net.snap(lon, lat, { maxMeters: Math.min(radius, 12) });
    if (this.snapped && level == null && this.snapped.level < 0 && source === "gps") this.snapped = null;
    this.emit();
    return this.snapped ? { lat: this.snapped.lat, lon: this.snapped.lon, level: this.snapped.level, edge: this.snapped.edge, offsetMeters: this.snapped.dist } : null;
  }

  clear() {
    this.raw = null;
    this.snapped = null;
    this.emit();
  }

  get position() {
    if (!this.raw) return null;
    if (this.snapped) return { lon: this.snapped.lon, lat: this.snapped.lat, level: this.snapped.level, source: this.raw.source };
    return { lon: this.raw.lon, lat: this.raw.lat, level: this.raw.level, source: this.raw.source };
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

  async startCompass() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return false;
    try {
      if (typeof DOE.requestPermission === "function") {
        const r = await DOE.requestPermission();
        if (r !== "granted") return false;
      }
    } catch (e) {
      return false;
    }
    window.addEventListener("deviceorientationabsolute", this.onOrientation);
    window.addEventListener("deviceorientation", this.onOrientation);
    return true;
  }

  onOrientation(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === "number") h = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === "number") h = (360 - e.alpha) % 360;
    else return;
    const scr = (screen.orientation && screen.orientation.angle) || 0;
    h = (h + scr + 360) % 360;
    if (this.heading == null || Math.abs(((h - this.heading + 540) % 360) - 180) > 2) {
      this.heading = h;
      this.emit();
    }
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
