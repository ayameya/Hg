export const CAT_COLORS = {
  station: "#1f6fd1",
  mall: "#d1491f",
  building: "#8a4fc9",
  public: "#1a9e6a",
};

export const CAT_LABELS = {
  station: "駅構内・駅コンコース",
  mall: "地下街",
  building: "ビル地下・連絡通路",
  public: "公共地下道・横断地下道",
};

export const FACILITY = {
  national: { label: "国の機関", color: "#6b3fa0", glyph: "国", zoom: 13 },
  tokyo: { label: "都の機関・都立施設", color: "#0b7a75", glyph: "都", zoom: 13 },
  ward: { label: "区の施設", color: "#4f7f2a", glyph: "区", zoom: 14 },
  police: { label: "警察署・交番", color: "#2c4a8a", glyph: "警", zoom: 14 },
  fire: { label: "消防署", color: "#b8321f", glyph: "消", zoom: 15 },
  post: { label: "郵便局", color: "#d0342c", glyph: "〒", zoom: 15 },
  culture: { label: "図書館・博物館・美術館", color: "#8a5a14", glyph: "館", zoom: 14 },
  sports: { label: "スポーツ施設", color: "#3b7fb0", glyph: "運", zoom: 16 },
  school: { label: "学校", color: "#5a6b2f", glyph: "文", zoom: 15 },
  medical: { label: "病院", color: "#c0392b", glyph: "+", zoom: 15 },
  welfare: { label: "福祉施設・保育所", color: "#9a6aa8", glyph: "福", zoom: 17 },
  toilet: { label: "公衆トイレ", color: "#2d7fa6", glyph: "W", zoom: 16 },
  park: { label: "公園", color: "#3f8f3f", glyph: "", zoom: 15 },
  embassy: { label: "大使館・領事館", color: "#9b2335", glyph: "大", zoom: 14 },
  other: { label: "その他の公的機関", color: "#6f6f6f", glyph: "公", zoom: 16 },
};

const ROAD_W = {
  1: [[10, 1.6], [14, 3], [16, 7], [19, 22]],
  2: [[10, 1.4], [14, 2.6], [16, 6], [19, 20]],
  3: [[10, 1], [14, 2.2], [16, 5], [19, 18]],
  4: [[11, 0.7], [14, 1.8], [16, 4], [19, 15]],
  5: [[12, 0.6], [14, 1.4], [16, 3.2], [19, 12]],
  6: [[13, 0.5], [15, 1], [16, 2], [19, 8]],
  7: [[14, 0.4], [16, 1.2], [19, 5]],
  8: [[15, 0.4], [17, 1], [19, 2.5]],
};
const ROAD_C = { 1: "#e9b86a", 2: "#e9c486", 3: "#c9c4b8", 4: "#cfcabe", 5: "#d4d0c6", 6: "#dcd8cf", 7: "#e2dfd8", 8: "#d9d3c8" };

function interp(stops, z) {
  if (z <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (z <= stops[i][0]) {
      const [z0, v0] = stops[i - 1];
      const [z1, v1] = stops[i];
      return v0 * (v1 / v0) ** ((z - z0) / (z1 - z0));
    }
  }
  return stops[stops.length - 1][1];
}

function addParts(p, parts, closed) {
  for (const ring of parts) {
    p.moveTo(ring[0], ring[1]);
    for (let i = 2; i < ring.length; i += 2) p.lineTo(ring[i], ring[i + 1]);
    if (closed) p.closePath();
  }
}

function bucketKey(layer, props) {
  switch (layer) {
    case "road":
      return String(props.c || 6);
    case "rail":
      return `${props.c || ""}|${props.t ? 1 : 0}|${props.s ? 1 : 0}`;
    case "waterway":
      return props.r ? "r" : "s";
    case "ferry":
      return "f";
    default:
      return "_";
  }
}

const PATH_LAYERS = ["water", "park", "block", "waterway", "road", "rail", "ward", "bus", "ferry"];
const POINT_LAYERS = ["station", "facility", "place", "wlabel", "bstop", "ferry"];

export const style = {
  background: "#fbfaf7",
  prepare(layers) {
    const paths = {};
    const points = [];
    let extent = 4096;
    for (const name of PATH_LAYERS) {
      const l = layers[name];
      if (!l) continue;
      extent = l.extent;
      const groups = new Map();
      for (const f of l.features) {
        if (f.type === 1) continue;
        const k = bucketKey(name, f.props);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(f);
      }
      const buckets = [];
      for (const [k, fs] of groups) {
        const p = new Path2D();
        for (const f of fs) addParts(p, f.parts, f.type === 3);
        buckets.push([k, p]);
      }
      if (name === "road") buckets.sort((a, b) => Number(b[0]) - Number(a[0]));
      paths[name] = buckets;
    }
    for (const name of POINT_LAYERS) {
      const l = layers[name];
      if (!l) continue;
      for (const f of l.features) {
        if (f.type !== 1) continue;
        for (const part of f.parts) points.push({ layer: name, x: part[0], y: part[1], props: f.props });
      }
    }
    return { extent, paths, points };
  },
  layers: [
    { source: "water", paint: () => ({ fill: "#d3e5f2" }) },
    { source: "park", minzoom: 13, paint: () => ({ fill: "#e8f0df" }) },
    { source: "block", minzoom: 15, group: "building", paint: (k, z) => ({ fill: "#f0ede7", stroke: "#cbc5ba", width: z < 16 ? 0.4 : 0.7 }) },
    { source: "waterway", paint: (k, z) => ({ stroke: "#bcd6ea", width: k === "r" ? interp([[11, 1], [16, 4]], z) : 0.8 }) },
    { source: "road", paint: (k, z) => (z < ROAD_W[k][0][0] ? null : { stroke: ROAD_C[k], width: interp(ROAD_W[k], z), dash: k === "8" ? [2, 2] : null }) },
    { source: "ward", paint: (k, z) => ({ stroke: "#a99bbd", width: z < 13 ? 1 : 1.6, dash: [5, 3] }) },
    { source: "bus", group: "bus", paint: (k, z) => ({ stroke: "rgba(224,138,30,0.55)", width: z < 15 ? 1.2 : 2.4 }) },
    { source: "ferry", group: "ferry", paint: () => ({ stroke: "#3a7dc9", width: 1.4, dash: [5, 4] }) },
    {
      source: "rail",
      group: "rail",
      paint: (k, z) => {
        const [c, t, s] = k.split("|");
        const w = interp([[10, s === "1" ? 0.5 : 1.2], [16, s === "1" ? 1 : 3], [19, s === "1" ? 2 : 6]], z);
        if (t === "1") return { stroke: c ? `${c}80` : "#9a9a9a80", width: w, dash: [4, 3] };
        return { stroke: c || "#6d6d6d", width: w };
      },
    },
  ],
  point(p, z, hidden) {
    const pr = p.props;
    switch (p.layer) {
      case "wlabel":
        if (z >= 14) return null;
        return { priority: 40, text: pr.n, font: "700 15px system-ui, sans-serif", size: 15, textColor: "#6d5f86", textRequired: true };
      case "place":
        if (z < (pr.k === 1 ? 14 : 16)) return null;
        return { priority: 60, text: pr.n, font: "12px system-ui, sans-serif", size: 12, textColor: "#8a8478", textRequired: true };
      case "station":
        if (hidden.has("station") || z < 11) return null;
        return { priority: 10, radius: z < 14 ? 3 : 5, color: "#fff", ring: "#222", ringWidth: 2, text: z >= 12.5 ? pr.n : null, font: "700 13px system-ui, sans-serif", size: 13, textColor: "#111" };
      case "bstop":
        if (hidden.has("bus") || z < 17) return null;
        return { priority: 70, radius: 3, color: "#fff", ring: "#e08a1e", text: z >= 18 ? pr.n : null, font: "11px system-ui, sans-serif", size: 11, textColor: "#a2600f" };
      case "ferry":
        if (hidden.has("ferry") || !pr.k) return null;
        return { priority: 20, radius: 6, color: "#3a7dc9", ring: "#fff", glyph: "船", text: z >= 13 ? pr.n : null, font: "12px system-ui, sans-serif", size: 12, textColor: "#2b5f9a" };
      case "facility": {
        const g = FACILITY[pr.g];
        if (!g || hidden.has(`fac:${pr.g}`) || hidden.has("facility")) return null;
        let minz = g.zoom;
        if (pr.g === "police" && pr.s === "station") minz = 13;
        if (pr.g === "ward" && pr.s === "townhall") minz = 12;
        if (z < minz) return null;
        const big = z >= minz + 1.5 && g.glyph;
        return {
          priority: 30 + Object.keys(FACILITY).indexOf(pr.g),
          radius: big ? 7 : 3.5,
          color: g.color,
          ring: "#fff",
          glyph: big ? g.glyph : null,
          text: z >= minz + 2 ? pr.n : null,
          font: "11px system-ui, sans-serif",
          size: 11,
          textColor: g.color,
        };
      }
      default:
        return null;
    }
  },
};
