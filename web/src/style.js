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

export const FAC_COLORS = {
  national: "#6b3fa0",
  tokyo: "#0b7a75",
  ward: "#4f7f2a",
  other_gov: "#777777",
  embassy: "#c0392b",
};

export const FAC_LABELS = {
  national: "国の施設",
  tokyo: "東京都の施設",
  ward: "区の施設",
  other_gov: "その他の官公署",
  embassy: "大使館・領事館",
};

const FONT = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Medium"];
const NAME = ["coalesce", ["get", "name"], ""];

export function baseStyle(pmtilesUrl, glyphsUrl) {
  return {
    version: 8,
    glyphs: glyphsUrl,
    sources: {
      base: {
        type: "vector",
        url: pmtilesUrl,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>',
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#f6f5f1" } },
      { id: "green", type: "fill", source: "base", "source-layer": "green", paint: { "fill-color": "#e2ecd6" } },
      { id: "water", type: "fill", source: "base", "source-layer": "water", paint: { "fill-color": "#c9dfee" } },
      {
        id: "waterway", type: "line", source: "base", "source-layer": "waterway",
        paint: { "line-color": "#c9dfee", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 16, 4] },
      },
      {
        id: "building", type: "fill", source: "base", "source-layer": "building", minzoom: 14,
        paint: { "fill-color": "#ebe9e3", "fill-outline-color": "#d6d3ca", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 15, 1] },
      },
      {
        id: "road-casing", type: "line", source: "base", "source-layer": "road",
        filter: ["all", ["!=", ["get", "tunnel"], 1], ["!=", ["get", "class"], "path"]],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#d8d5cc",
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"],
            10, ["match", ["get", "class"], ["motorway", "trunk"], 2.2, "primary", 1.8, "secondary", 1.4, 0.6],
            16, ["match", ["get", "class"], ["motorway", "trunk"], 16, "primary", 14, "secondary", 12, "tertiary", 10, "minor", 7, 4],
            18, ["match", ["get", "class"], ["motorway", "trunk"], 40, "primary", 34, "secondary", 30, "tertiary", 26, "minor", 18, 10]],
        },
      },
      {
        id: "road", type: "line", source: "base", "source-layer": "road",
        filter: ["all", ["!=", ["get", "tunnel"], 1], ["!=", ["get", "class"], "path"]],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["match", ["get", "class"], ["motorway", "trunk"], "#fbe7c6", "#ffffff"],
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"],
            10, ["match", ["get", "class"], ["motorway", "trunk"], 1.4, "primary", 1.1, "secondary", 0.8, 0.3],
            16, ["match", ["get", "class"], ["motorway", "trunk"], 13, "primary", 11.5, "secondary", 9.5, "tertiary", 8, "minor", 5.5, 3],
            18, ["match", ["get", "class"], ["motorway", "trunk"], 36, "primary", 31, "secondary", 27, "tertiary", 23, "minor", 16, 8]],
        },
      },
      {
        id: "path", type: "line", source: "base", "source-layer": "road", minzoom: 15,
        filter: ["==", ["get", "class"], "path"],
        paint: { "line-color": "#d2cfc6", "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.5, 18, 2], "line-dasharray": [2, 1] },
      },
      {
        id: "ward-line", type: "line", source: "base", "source-layer": "ward",
        paint: { "line-color": "#9c8fb0", "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.8, 15, 2.2], "line-dasharray": [3, 1.5, 1, 1.5] },
      },
      {
        id: "ferry-route", type: "line", source: "base", "source-layer": "ferry",
        filter: ["==", ["get", "kind"], "ferry_route"],
        metadata: { group: "ferry" },
        paint: { "line-color": "#3a7dc9", "line-width": 1.6, "line-dasharray": [4, 3] },
      },
      {
        id: "bus-route", type: "line", source: "base", "source-layer": "bus_route",
        metadata: { group: "bus" },
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#e08a1e",
          "line-opacity": 0.55,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, ["min", 3, ["+", 0.6, ["*", 0.25, ["get", "n"]]]], 17, ["min", 8, ["+", 1.5, ["*", 0.6, ["get", "n"]]]]],
        },
      },
      {
        id: "rail-tunnel", type: "line", source: "base", "source-layer": "rail",
        filter: ["==", ["get", "tunnel"], 1],
        metadata: { group: "rail" },
        paint: {
          "line-color": ["coalesce", ["get", "colour"], "#8a8a8a"],
          "line-opacity": 0.5,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 16, 3.5],
          "line-dasharray": [2, 1.2],
        },
      },
      {
        id: "rail-casing", type: "line", source: "base", "source-layer": "rail",
        filter: ["all", ["!=", ["get", "tunnel"], 1], ["!", ["has", "colour"]]],
        metadata: { group: "rail" },
        paint: { "line-color": "#777777", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.4, 16, 4] },
      },
      {
        id: "rail-hatch", type: "line", source: "base", "source-layer": "rail",
        filter: ["all", ["!=", ["get", "tunnel"], 1], ["!", ["has", "colour"]]],
        metadata: { group: "rail" },
        paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 16, 2], "line-dasharray": [3, 3] },
      },
      {
        id: "rail-colour", type: "line", source: "base", "source-layer": "rail",
        filter: ["all", ["!=", ["get", "tunnel"], 1], ["has", "colour"]],
        metadata: { group: "rail" },
        paint: { "line-color": ["get", "colour"], "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.4, 16, 4] },
      },
      {
        id: "bus-stop", type: "circle", source: "base", "source-layer": "bus_stop", minzoom: 15,
        metadata: { group: "busstop" },
        paint: { "circle-radius": 3, "circle-color": "#ffffff", "circle-stroke-color": "#e08a1e", "circle-stroke-width": 1.5 },
      },
      {
        id: "ferry-terminal", type: "circle", source: "base", "source-layer": "ferry",
        filter: ["==", ["get", "kind"], "ferry_terminal"],
        metadata: { group: "ferry" },
        paint: { "circle-radius": 6, "circle-color": "#3a7dc9", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
      },
      {
        id: "facility", type: "circle", source: "base", "source-layer": "facility",
        metadata: { group: "facility" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 16, 6],
          "circle-color": ["match", ["get", "cat"], "national", FAC_COLORS.national, "tokyo", FAC_COLORS.tokyo, "ward", FAC_COLORS.ward, "embassy", FAC_COLORS.embassy, FAC_COLORS.other_gov],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      },
      {
        id: "station", type: "circle", source: "base", "source-layer": "station",
        metadata: { group: "station" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2.5, 16, 6],
          "circle-color": "#ffffff",
          "circle-stroke-color": "#333333",
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 1.2, 16, 2],
        },
      },
    ],
  };
}

export function labelLayers() {
  return [
    {
      id: "road-label", type: "symbol", source: "base", "source-layer": "road", minzoom: 14,
      filter: ["all", ["has", "name"], ["match", ["get", "class"], ["motorway", "trunk", "primary", "secondary", "tertiary"], true, false]],
      layout: { "symbol-placement": "line", "text-field": NAME, "text-font": FONT, "text-size": 11 },
      paint: { "text-color": "#6f6a60", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
    },
    {
      id: "place-label", type: "symbol", source: "base", "source-layer": "place",
      layout: { "text-field": NAME, "text-font": FONT, "text-size": ["match", ["get", "kind"], ["quarter", "neighbourhood"], 11, 13] },
      paint: { "text-color": "#8a8478", "text-halo-color": "#f6f5f1", "text-halo-width": 1.5 },
    },
    {
      id: "ward-label", type: "symbol", source: "base", "source-layer": "ward_label", maxzoom: 14,
      layout: { "text-field": NAME, "text-font": FONT_BOLD, "text-size": ["interpolate", ["linear"], ["zoom"], 9, 12, 13, 18] },
      paint: { "text-color": "#6d5f86", "text-halo-color": "#ffffff", "text-halo-width": 2 },
    },
    {
      id: "facility-label", type: "symbol", source: "base", "source-layer": "facility", minzoom: 14,
      metadata: { group: "facility" },
      layout: { "text-field": NAME, "text-font": FONT, "text-size": 11, "text-offset": [0, 0.9], "text-anchor": "top", "text-optional": true },
      paint: {
        "text-color": ["match", ["get", "cat"], "national", FAC_COLORS.national, "tokyo", FAC_COLORS.tokyo, "ward", FAC_COLORS.ward, "embassy", FAC_COLORS.embassy, FAC_COLORS.other_gov],
        "text-halo-color": "#ffffff", "text-halo-width": 1.5,
      },
    },
    {
      id: "ferry-label", type: "symbol", source: "base", "source-layer": "ferry", minzoom: 12,
      filter: ["==", ["get", "kind"], "ferry_terminal"],
      metadata: { group: "ferry" },
      layout: { "text-field": NAME, "text-font": FONT, "text-size": 11, "text-offset": [0, 1], "text-anchor": "top" },
      paint: { "text-color": "#2b5f9a", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
    },
    {
      id: "busstop-label", type: "symbol", source: "base", "source-layer": "bus_stop", minzoom: 17,
      metadata: { group: "busstop" },
      layout: { "text-field": NAME, "text-font": FONT, "text-size": 10, "text-offset": [0, 0.8], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": "#a2600f", "text-halo-color": "#ffffff", "text-halo-width": 1.2 },
    },
    {
      id: "station-label", type: "symbol", source: "base", "source-layer": "station", minzoom: 12,
      metadata: { group: "station" },
      layout: { "text-field": NAME, "text-font": FONT_BOLD, "text-size": ["interpolate", ["linear"], ["zoom"], 12, 11, 16, 14], "text-offset": [0, 0.9], "text-anchor": "top" },
      paint: { "text-color": "#222222", "text-halo-color": "#ffffff", "text-halo-width": 2 },
    },
  ];
}

export function networkLayers() {
  const catColor = ["match", ["get", "cat"], "station", CAT_COLORS.station, "mall", CAT_COLORS.mall, "building", CAT_COLORS.building, CAT_COLORS.public];
  const width = ["interpolate", ["linear"], ["zoom"], 11, 1.2, 15, 3, 18, 7];
  return [
    {
      id: "ug-area", type: "fill", source: "areas", minzoom: 14,
      paint: { "fill-color": "#6d8fb3", "fill-opacity": 0.18, "fill-outline-color": "#6d8fb3" },
    },
    {
      id: "net-closed", type: "line", source: "net",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#c23b3b",
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.8, 15, 2, 18, 4],
        "line-dasharray": [1, 1.5],
        "line-opacity": ["case", ["==", ["feature-state", "st"], 0], 0.75, 0],
      },
    },
    {
      id: "net-isolated", type: "line", source: "net",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#9a9a9a",
        "line-width": width,
        "line-opacity": ["case", ["==", ["feature-state", "st"], 1], 0.8, 0],
      },
    },
    {
      id: "net-open-casing", type: "line", source: "net",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.4, 15, 5.5, 18, 11],
        "line-opacity": ["case", ["==", ["feature-state", "st"], 2], 0.9, 0],
      },
    },
    {
      id: "net-open", type: "line", source: "net",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": catColor,
        "line-width": width,
        "line-opacity": ["case", ["==", ["feature-state", "st"], 2], 1, 0],
      },
    },
    {
      id: "net-hit", type: "line", source: "net",
      paint: { "line-color": "#000000", "line-width": 12, "line-opacity": 0 },
    },
    {
      id: "route", type: "line", source: "route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffcc00", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4, 18, 12], "line-opacity": 0.85 },
    },
    {
      id: "access", type: "circle", source: "access", minzoom: 14,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2.5, 18, 7],
        "circle-color": ["case", ["==", ["feature-state", "open"], false], "#c23b3b", ["==", ["get", "entrance"], 1], "#111111", "#ffffff"],
        "circle-stroke-color": ["case", ["==", ["feature-state", "open"], false], "#ffffff", "#111111"],
        "circle-stroke-width": 1.2,
        "circle-opacity": accessOpacity(false),
        "circle-stroke-opacity": accessOpacity(false),
      },
    },
    {
      id: "access-label", type: "symbol", source: "access", minzoom: 16,
      filter: ["!=", ["get", "ref"], ""],
      layout: { "text-field": ["get", "ref"], "text-font": FONT_BOLD, "text-size": 11, "text-offset": [0, -1.1], "text-allow-overlap": false },
      paint: { "text-color": "#111111", "text-halo-color": "#ffffff", "text-halo-width": 2 },
    },
    {
      id: "route-ends", type: "circle", source: "route-ends",
      paint: { "circle-radius": 7, "circle-color": ["match", ["get", "kind"], "from", "#1a9e6a", "#c23b3b"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
    },
  ];
}

export function accessOpacity(showClosed) {
  return ["case", ["==", ["feature-state", "open"], false], showClosed ? 1 : 0, 1];
}
