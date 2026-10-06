export const PALETTE = {
  background: "#fbfaf7",
  water: "#d3e5f2",
  waterway: "#bcd6ea",
  park: "#eef0dc",
  building: "#e6e2da",
  buildingLine: "#c9c2b5",
  entranceBuilding: "#7058a3",
  entranceBuildingLine: "#4f3d7d",
  ward: "#a99bbd",
  bus: "#e08a1e",
  ferry: "#3a7dc9",
};

export const RESERVED = {
  adMint: "#98d6b4",
};

export const CAT_COLORS = {
  station: "#1f6fd1",
  mall: "#d1491f",
  building: "#b8860b",
  public: "#00838f",
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
  park: { label: "公園", color: "#7c8b2a", glyph: "", zoom: 15 },
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

for (const [k, g] of Object.entries(FACILITY)) {
  g.iconBig = `fac:${k}:1`;
  g.iconSmall = `fac:${k}:0`;
  g.textKey = `fac:${k}:`;
}

export function interp(stops, z) {
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

export const POINT_LAYERS = ["station", "facility", "place", "wlabel", "bstop", "ferry"];

export const LAYERS = [
  { id: "water", source: "water", type: "fill", bucket: () => "_", paint: () => ({ color: PALETTE.water }) },
  { id: "park", source: "park", type: "fill", minzoom: 13, bucket: () => "_", paint: () => ({ color: PALETTE.park }) },
  {
    id: "waterway", source: "waterway", type: "line", bucket: (p) => (p.r ? "r" : "s"),
    paint: (k, z) => ({ color: PALETTE.waterway, width: k === "r" ? interp([[11, 1], [16, 4], [19, 10]], z) : 0.8 }),
  },
  {
    id: "road", source: "road", type: "line", bucket: (p) => String(p.c || 6), order: ["8", "7", "6", "5", "4", "3", "2", "1"],
    paint: (k, z) => (z < ROAD_W[k][0][0] ? null : { color: ROAD_C[k], width: interp(ROAD_W[k], z), dash: k === "8" ? [2, 2] : null }),
  },
  {
    id: "building", source: "bld", type: "fill", outline: true, minzoom: 14, group: "building", bucket: (p) => (p.u ? "u" : "b"), order: ["b", "u"],
    paint: (k, z) => (k === "u"
      ? { color: PALETTE.entranceBuilding, outline: PALETTE.entranceBuildingLine, opacity: z < 14.5 ? (z - 14) * 2 : 1 }
      : { color: PALETTE.building, outline: z >= 15.5 ? PALETTE.buildingLine : null, opacity: z < 14.5 ? (z - 14) * 2 : 1 }),
  },
  { id: "ward", source: "ward", type: "line", bucket: () => "_", paint: (k, z) => ({ color: PALETTE.ward, width: z < 13 ? 1 : 1.6, dash: [5, 3] }) },
  { id: "bus", source: "bus", type: "line", group: "bus", bucket: () => "_", paint: (k, z) => ({ color: PALETTE.bus, opacity: 0.55, width: z < 15 ? 1.2 : 2.4 }) },
  { id: "ferry", source: "ferry", type: "line", group: "ferry", bucket: () => "_", paint: () => ({ color: PALETTE.ferry, width: 1.4, dash: [5, 4] }) },
  {
    id: "rail", source: "rail", type: "line", group: "rail", bucket: (p) => `${p.c || ""}|${p.t ? 1 : 0}|${p.s ? 1 : 0}`,
    paint: (k, z) => {
      const [c, t, s] = k.split("|");
      const w = interp([[10, s === "1" ? 0.5 : 1.2], [16, s === "1" ? 1 : 3], [19, s === "1" ? 2 : 6]], z);
      if (t === "1") return { color: c || "#9a9a9a", opacity: 0.5, width: w, dash: [4, 3] };
      return { color: c || "#6d6d6d", width: w };
    },
  },
];

export const style = {
  background: PALETTE.background,
  point(p, z, hidden) {
    const pr = p.props;
    switch (p.layer) {
      case "wlabel":
        if (z >= 14) return null;
        return { priority: 40, text: pr.n, font: "700 15px system-ui, sans-serif", size: 15, textColor: "#6d5f86", textRequired: true };
      case "building":
        if (hidden.has("building") || z < (pr.u ? 16 : 17.5)) return null;
        return { priority: pr.u ? 25 : 65, text: pr.n, font: `${pr.u ? "700 " : ""}11px system-ui, sans-serif`, size: 11, textColor: pr.u ? PALETTE.entranceBuildingLine : "#7a756b", textRequired: true };
      case "place":
        if (z < (pr.k === 1 ? 14 : 16)) return null;
        return { priority: 60, text: pr.n, font: "12px system-ui, sans-serif", size: 12, textColor: "#8a8478", textRequired: true };
      case "station":
        if (hidden.has("station") || z < 11) return null;
        return { priority: 10, iconKey: z < 14 ? "st:3" : "st:5", textKey: "st:", radius: z < 14 ? 3 : 5, color: "#fff", ring: "#222", ringWidth: 2, text: z >= 12.5 ? pr.n : null, font: "700 13px system-ui, sans-serif", size: 13, textColor: "#111" };
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
          iconKey: big ? g.iconBig : g.iconSmall,
          textKey: g.textKey,
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
