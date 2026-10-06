import { PMTiles } from "../map/pmtiles.js";
import { decodeTile } from "../map/mvt.js";
import { buildTile } from "./tilebuild.js";

let source = null;
const cancelled = new Set();

self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === "init") {
    source = new PMTiles(m.url, m.parts);
    return;
  }
  if (m.type === "cancel") {
    cancelled.add(m.id);
    return;
  }
  if (m.type !== "tile") return;
  const { id, z, x, y } = m;
  try {
    if (cancelled.has(id)) {
      cancelled.delete(id);
      self.postMessage({ type: "tile", id, cancelled: true });
      return;
    }
    const bytes = await source.tile(z, x, y);
    if (cancelled.has(id)) {
      cancelled.delete(id);
      self.postMessage({ type: "tile", id, cancelled: true });
      return;
    }
    if (!bytes) {
      self.postMessage({ type: "tile", id, data: null });
      return;
    }
    const t0 = performance.now();
    const data = buildTile(decodeTile(bytes));
    data.buildMs = performance.now() - t0;
    const transfer = [data.fill.pos.buffer, data.fill.idx.buffer, data.fill.outline.buffer, data.line.v.buffer, data.line.idx.buffer, ...data.picks.map((p) => p.ring.buffer)];
    self.postMessage({ type: "tile", id, data }, transfer);
  } catch (e) {
    self.postMessage({ type: "tile", id, error: String(e && e.message || e) });
  }
};
