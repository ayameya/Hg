import { LAYERS, POINT_LAYERS } from "../style.js";
import { FillBuilder, LineBuilder, groupRings } from "./tess.js";

function orderedBuckets(layer, groups) {
  const keys = [...groups.keys()];
  if (!layer.order) return keys;
  return keys.sort((a, b) => {
    const ia = layer.order.indexOf(a);
    const ib = layer.order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

function centroid(ring) {
  let x = 0;
  let y = 0;
  const n = ring.length / 2;
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i];
    y += ring[i + 1];
  }
  return [x / n, y / n];
}

export function buildTile(layers) {
  const fill = new FillBuilder();
  const line = new LineBuilder();
  const fillRanges = [];
  const lineRanges = [];
  const picks = [];
  let extent = 4096;
  for (const layer of LAYERS) {
    const l = layers[layer.source];
    if (!l) continue;
    extent = l.extent;
    const groups = new Map();
    for (const f of l.features) {
      if (f.type === 1) continue;
      if (layer.type === "fill" && f.type !== 3) continue;
      const k = layer.bucket(f.props);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(f);
    }
    for (const key of orderedBuckets(layer, groups)) {
      const fs = groups.get(key);
      if (layer.type === "fill") {
        const start = fill.idx.length;
        const ostart = fill.outline.length;
        for (const f of fs) {
          for (const rings of groupRings(f.parts)) {
            fill.addPolygon(rings, !!layer.outline);
            if (layer.id === "building" && (f.props.n || f.props.u)) {
              picks.push({ ring: Float32Array.from(rings[0]), props: f.props, c: centroid(rings[0]) });
            }
          }
        }
        fillRanges.push({ layer: layer.id, key, start, count: fill.idx.length - start, ostart, ocount: fill.outline.length - ostart });
      } else {
        const start = line.idx.length;
        for (const f of fs) for (const part of f.parts) line.addLine(part, f.type === 3);
        lineRanges.push({ layer: layer.id, key, start, count: line.idx.length - start });
      }
    }
  }
  const points = [];
  for (const name of POINT_LAYERS) {
    const l = layers[name];
    if (!l) continue;
    for (const f of l.features) {
      if (f.type !== 1) continue;
      for (const part of f.parts) points.push({ layer: name, x: part[0], y: part[1], props: f.props });
    }
  }
  for (const p of picks) if (p.props.n) points.push({ layer: "building", x: p.c[0], y: p.c[1], props: p.props });
  return {
    extent,
    fill: { pos: fill.pos.final(), idx: fill.idx.final(), outline: fill.outline.final(), ranges: fillRanges },
    line: { v: line.v.final(), idx: line.idx.final(), ranges: lineRanges },
    points,
    picks,
  };
}

