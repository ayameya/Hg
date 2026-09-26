import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { Network } from "./network.js";
import { CAT_COLORS, CAT_LABELS, FAC_COLORS, FAC_LABELS, accessOpacity, baseStyle, labelLayers, networkLayers } from "./style.js";

const $ = (s) => document.querySelector(s);
const SRC_LABELS = { osm: "OSM opening_hours", override: "個別ルール", default: "種別ごとの推定値", virtual: "仮接続" };
const CONF_LABELS = { high: "高", medium: "中", low: "低" };
const HW_LABELS = { steps: "階段", elevator: "エレベーター", footway: "通路", corridor: "屋内通路", pedestrian: "歩行者空間", path: "小径", virtual: "仮接続" };
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const base = new URL(".", location.href);
const map = new maplibregl.Map({
  container: "map",
  style: baseStyle(`pmtiles://${new URL("data/base.pmtiles", base)}`, `${new URL("fonts", base)}/{fontstack}/{range}.pbf`),
  center: [139.7671, 35.6812],
  zoom: 15,
  minZoom: 9,
  maxZoom: 19,
  maxBounds: [[139.3, 35.35], [140.2, 36.0]],
  hash: "map",
  localIdeographFontFamily: "'Hiragino Kaku Gothic ProN','Hiragino Sans','Noto Sans CJK JP','Noto Sans JP','Yu Gothic',Meiryo,sans-serif",
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), "top-right");

let net = null;
let routeMode = false;
let routeFrom = null;
let routeTo = null;
let lastEval = null;

function tokyoNow() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: (parseInt(g("hour"), 10) % 24) * 60 + parseInt(g("minute"), 10) };
}

function currentDate() {
  const [y, m, d] = $("#date").value.split("-").map(Number);
  const mins = parseInt($("#time").value, 10);
  return new Date(y, m - 1, d, Math.floor(mins / 60), mins % 60);
}

function fmtMinutes(m) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function fmtDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]}) ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function setNow() {
  const now = tokyoNow();
  $("#date").value = now.date;
  $("#time").value = String(now.minutes - (now.minutes % 5));
  update();
}

function isHoliday(date) {
  return net ? net.isHoliday(date) : false;
}

function updateTimeLabel() {
  const d = currentDate();
  $("#time-label").textContent = fmtMinutes(parseInt($("#time").value, 10));
  const kind = isHoliday(d) ? "祝日" : d.getDay() === 0 ? "日曜" : d.getDay() === 6 ? "土曜" : "平日";
  $("#day-kind").textContent = `${WEEK[d.getDay()]}曜日・${kind}`;
}

function mode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function update() {
  if (!net) return;
  updateTimeLabel();
  const m = mode();
  const ignore = m === "all";
  const res = net.evaluate(currentDate(), ignore);
  lastEval = res;
  const hideIsolated = $("#hide-isolated").checked;
  for (const i of res.changed) {
    map.setFeatureState({ source: "net", id: i }, { st: net.edgeState[i] });
  }
  map.setPaintProperty("net-isolated", "line-opacity", ["case", ["==", ["feature-state", "st"], 1], hideIsolated ? 0 : 0.8, 0]);
  map.setLayoutProperty("net-closed", "visibility", m === "closed" ? "visible" : "none");
  map.setPaintProperty("access", "circle-opacity", accessOpacity(m === "closed"));
  map.setPaintProperty("access", "circle-stroke-opacity", accessOpacity(m === "closed"));
  for (let i = 0; i < net.nodes.length; i++) {
    if (!(net.nodes[i][2] & 1)) continue;
    map.setFeatureState({ source: "access", id: i }, { open: !!net.nodeOpen[i] && net.adj[i].some((e) => net.usable[e]) });
  }
  const km = (x) => (x / 1000).toFixed(1);
  $("#stats").innerHTML = ignore
    ? `全区間 <b>${km(res.totalLen)} km</b>（時刻を無視）`
    : `通行可 <b>${km(res.reachLen)} km</b> / 全 ${km(res.totalLen)} km<br><span class="muted">うち地上から入れない区間 ${km(res.openLen - res.reachLen)} km・閉鎖 ${km(res.totalLen - res.openLen)} km</span>`;
  if (routeFrom !== null && routeTo !== null) computeRoute();
}

function buildNetworkGeoJSON() {
  const { ef } = net;
  const features = net.edges.map((e, i) => ({
    type: "Feature",
    id: i,
    geometry: { type: "LineString", coordinates: e[ef.coords] },
    properties: { cat: e[ef.cat], hw: e[ef.highway], conn: e[ef.connector] },
  }));
  const access = [];
  net.nodes.forEach((n, i) => {
    if (!(n[2] & 1)) return;
    access.push({
      type: "Feature",
      id: i,
      geometry: { type: "Point", coordinates: [n[0], n[1]] },
      properties: { entrance: n[2] & 2 ? 1 : 0, elevator: n[2] & 4 ? 1 : 0, ref: n[4] || "", name: n[5] || "" },
    });
  });
  return { edges: { type: "FeatureCollection", features }, access: { type: "FeatureCollection", features: access } };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function stateText(ohIdx, date) {
  const open = net.ohOpen(ohIdx, date);
  const next = net.nextChange(ohIdx, date);
  const nextTxt = next ? `（${fmtDate(next)} に${open ? "閉鎖" : "開放"}）` : "";
  return `<span class="${open ? "ok" : "ng"}">${open ? "通行可" : "閉鎖"}</span>${nextTxt}`;
}

function edgePopup(i, lngLat) {
  const e = net.edge(i);
  const date = currentDate();
  const levelTxt = e.level < 0 ? `B${Math.abs(e.level)}` : e.level === 0 ? "地上" : `${e.level}F`;
  const rule = e.rule ? net.rules[e.rule] : null;
  const src = rule && rule.source ? `<a href="${escapeHtml(rule.source)}" target="_blank" rel="noopener">出典</a>` : "";
  const st = lastEval && net.edgeState[i] === 1 ? '<div class="warn">この時刻は通路自体は開いていますが、つながる地上出入口がすべて閉鎖されています。</div>' : "";
  const osm = e.way ? `<a href="https://www.openstreetmap.org/way/${e.way}" target="_blank" rel="noopener">OSM way/${e.way}</a>` : "";
  const html = `
    <div class="pp">
      <div class="pp-title"><span class="dot" style="background:${CAT_COLORS[e.cat]}"></span>${escapeHtml(e.name || HW_LABELS[e.highway] || e.highway)}</div>
      <table>
        <tr><th>種別</th><td>${CAT_LABELS[e.cat]}${e.connector ? "（地上との接続）" : ""}・${escapeHtml(HW_LABELS[e.highway] || e.highway)}</td></tr>
        <tr><th>階層</th><td>${levelTxt}</td></tr>
        <tr><th>通行時間</th><td><code>${escapeHtml(net.ohStrings[e.oh])}</code></td></tr>
        <tr><th>選択時刻</th><td>${stateText(e.oh, date)}</td></tr>
        <tr><th>時間の根拠</th><td>${SRC_LABELS[e.src] || e.src}（確度: ${CONF_LABELS[e.conf] || e.conf}）${rule ? `<br>${escapeHtml(rule.name || rule.id)} ${src}` : ""}<br><span class="muted">${escapeHtml(net.notes[e.note])}</span></td></tr>
        ${e.wheelchair ? `<tr><th>車いす</th><td>${escapeHtml(e.wheelchair)}</td></tr>` : ""}
        <tr><th>延長</th><td>${e.len.toFixed(0)} m</td></tr>
      </table>
      ${st}
      <div class="pp-foot">${osm}</div>
    </div>`;
  new maplibregl.Popup({ maxWidth: "340px" }).setLngLat(lngLat).setHTML(html).addTo(map);
}

function accessPopup(i, lngLat) {
  const n = net.node(i);
  const date = currentDate();
  const kind = n.flags & 4 ? "エレベーター" : n.flags & 2 ? "出入口" : "地上との接続点";
  const rule = n.rule ? net.rules[n.rule] : null;
  const basis = n.src === "osm" ? "OSM opening_hours" : rule ? `${escapeHtml(rule.name || rule.id)}（確度: ${CONF_LABELS[rule.confidence] || rule.confidence}）${rule.source ? ` <a href="${escapeHtml(rule.source)}" target="_blank" rel="noopener">出典</a>` : ""}<br><span class="muted">${escapeHtml(rule.note || "")}</span>` : "";
  const hours = n.oh >= 0 ? `<tr><th>利用時間</th><td><code>${escapeHtml(net.ohStrings[n.oh])}</code><br>${stateText(n.oh, date)}</td></tr><tr><th>根拠</th><td>${basis}</td></tr>` : '<tr><th>利用時間</th><td class="muted">個別の情報なし（つながる通路の時間に従う）</td></tr>';
  const usable = net.adj[i].some((e) => net.usable[e]);
  const html = `
    <div class="pp">
      <div class="pp-title">${escapeHtml((n.name && n.ref && n.name.includes(n.ref) ? n.name : [n.ref, n.name].filter(Boolean).join(" ")) || kind)}</div>
      <table>
        <tr><th>種別</th><td>${kind}</td></tr>
        ${hours}
        <tr><th>選択時刻</th><td><span class="${usable ? "ok" : "ng"}">${usable ? "利用可" : "利用不可"}</span></td></tr>
      </table>
      <div class="pp-foot"><a href="https://www.openstreetmap.org/node/${n.osm_id}" target="_blank" rel="noopener">OSM node/${n.osm_id}</a></div>
    </div>`;
  new maplibregl.Popup({ maxWidth: "300px" }).setLngLat(lngLat).setHTML(html).addTo(map);
}

function facilityPopup(f, lngLat) {
  const p = f.properties;
  const layer = f.layer.id;
  let kind = "";
  if (layer.startsWith("facility")) kind = `${FAC_LABELS[p.cat] || ""}${p.sub ? `（${p.sub}）` : ""}`;
  else if (layer.startsWith("station")) kind = `駅${p.operator ? `・${p.operator}` : ""}`;
  else if (layer.startsWith("ferry")) kind = "フェリー・水上バス乗り場";
  else if (layer.startsWith("bus-stop")) kind = `バス停${p.operator ? `・${p.operator}` : ""}`;
  else if (layer.startsWith("bus-route")) kind = `バス路線${p.operator ? `・${p.operator}` : ""}`;
  else if (layer.startsWith("rail")) kind = `鉄道${p.operator ? `・${p.operator}` : ""}`;
  const title = p.name || p.lines || p.routes || kind;
  const extra = [
    p.lines && layer.startsWith("rail") ? `<div>${escapeHtml(p.lines)}</div>` : "",
    p.routes ? `<div>系統: ${escapeHtml(p.routes)}</div>` : "",
    p.country ? `<div>国・地域: ${escapeHtml(p.country)}</div>` : "",
    p.name_en ? `<div class="muted">${escapeHtml(p.name_en)}</div>` : "",
    p.website ? `<div><a href="${escapeHtml(p.website)}" target="_blank" rel="noopener">Web</a></div>` : "",
    p.osm ? `<div class="pp-foot"><a href="https://www.openstreetmap.org/${escapeHtml(p.osm)}" target="_blank" rel="noopener">OSM ${escapeHtml(p.osm)}</a></div>` : "",
  ].join("");
  new maplibregl.Popup({ maxWidth: "300px" }).setLngLat(lngLat).setHTML(`<div class="pp"><div class="pp-title">${escapeHtml(title)}</div><div>${escapeHtml(kind)}</div>${extra}</div>`).addTo(map);
}

function setRouteEnds() {
  const feats = [];
  if (routeFrom !== null) feats.push({ type: "Feature", geometry: { type: "Point", coordinates: net.nodes[routeFrom].slice(0, 2) }, properties: { kind: "from" } });
  if (routeTo !== null) feats.push({ type: "Feature", geometry: { type: "Point", coordinates: net.nodes[routeTo].slice(0, 2) }, properties: { kind: "to" } });
  map.getSource("route-ends").setData({ type: "FeatureCollection", features: feats });
}

function computeRoute() {
  const res = net.route(routeFrom, routeTo, { stepFree: $("#step-free").checked });
  if (!res) {
    map.getSource("route").setData({ type: "FeatureCollection", features: [] });
    $("#route-info").innerHTML = '<span class="ng">この時刻に地下だけで結ぶ経路はありません。</span>';
    return;
  }
  map.getSource("route").setData({ type: "Feature", geometry: { type: "LineString", coordinates: res.line }, properties: {} });
  const mins = Math.max(1, Math.round(res.length / 80));
  $("#route-info").innerHTML = `地下経路 <b>${Math.round(res.length)} m</b>・徒歩約 <b>${mins} 分</b>`;
}

function clearRoute() {
  routeFrom = null;
  routeTo = null;
  map.getSource("route").setData({ type: "FeatureCollection", features: [] });
  setRouteEnds();
  $("#route-info").textContent = routeMode ? "出発地点を地図上でクリックしてください。" : "";
}

function handleRouteClick(lngLat) {
  const pick = net.nearestNode(lngLat.lng, lngLat.lat, (i) => net.adj[i].some((e) => net.usable[e]));
  if (pick.index < 0 || pick.meters > 300) {
    $("#route-info").innerHTML = '<span class="ng">近くに通行可能な地下通路がありません。</span>';
    return;
  }
  if (routeFrom === null || routeTo !== null) {
    routeFrom = pick.index;
    routeTo = null;
    map.getSource("route").setData({ type: "FeatureCollection", features: [] });
    $("#route-info").textContent = "到着地点をクリックしてください。";
  } else {
    routeTo = pick.index;
    computeRoute();
  }
  setRouteEnds();
}

function setupLayerToggles() {
  const groups = { rail: ["rail"], station: ["station"], bus: ["bus"], busstop: ["busstop"], ferry: ["ferry"], facility: ["facility"], building: [] };
  document.querySelectorAll("[data-group]").forEach((el) => {
    const apply = () => {
      const g = el.dataset.group;
      const vis = el.checked ? "visible" : "none";
      for (const layer of map.getStyle().layers) {
        const lg = layer.metadata && layer.metadata.group;
        if ((groups[g] || []).includes(lg) || (g === "building" && layer.id === "building")) map.setLayoutProperty(layer.id, "visibility", vis);
      }
      if (g === "facility") applyFacilityFilter();
    };
    el.addEventListener("change", apply);
    apply();
  });
  document.querySelectorAll("[data-fac]").forEach((el) => el.addEventListener("change", applyFacilityFilter));
}

function applyFacilityFilter() {
  const cats = [...document.querySelectorAll("[data-fac]")].filter((el) => el.checked).map((el) => el.dataset.fac);
  const f = ["match", ["get", "cat"], cats.length ? cats : ["__none__"], true, false];
  map.setFilter("facility", f);
  map.setFilter("facility-label", f);
}

function buildLegend() {
  $("#legend-cats").innerHTML = Object.entries(CAT_LABELS)
    .map(([k, v]) => `<div class="lg"><span class="sw" style="background:${CAT_COLORS[k]}"></span>${v}</div>`)
    .join("") + '<div class="lg"><span class="sw" style="background:#9a9a9a"></span>開いているが地上から入れない</div><div class="lg"><span class="sw dashed"></span>閉鎖中（表示モードによる）</div><div class="lg"><span class="pt"></span>出入口・地上接続点</div><div class="lg"><span class="sw area"></span>地下の広場・コンコース（面）</div>';
  $("#fac-list").innerHTML = Object.entries(FAC_LABELS)
    .map(([k, v]) => `<label><input type="checkbox" data-fac="${k}" ${k === "other_gov" ? "" : "checked"}><span class="sw round" style="background:${FAC_COLORS[k]}"></span>${v}</label>`)
    .join("");
}

async function init() {
  buildLegend();
  const [raw, areas] = await Promise.all([
    fetch(new URL("data/network.json", base)).then((r) => r.json()),
    fetch(new URL("data/areas.json", base)).then((r) => r.json()),
    new Promise((r) => (map.loaded() ? r() : map.once("load", r))),
  ]);
  net = new Network(raw);
  $("#meta").textContent = `データ: ${raw.source}・生成 ${raw.generated.slice(0, 10)}`;
  const gj = buildNetworkGeoJSON();
  map.addSource("areas", { type: "geojson", data: areas });
  map.addSource("net", { type: "geojson", data: gj.edges });
  map.addSource("access", { type: "geojson", data: gj.access });
  map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addSource("route-ends", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  for (const l of networkLayers()) map.addLayer(l);
  for (const l of labelLayers()) map.addLayer(l);
  map.moveLayer("access");
  map.moveLayer("access-label");
  map.moveLayer("route-ends");

  setupLayerToggles();
  $("#time").addEventListener("input", () => {
    updateTimeLabel();
    clearTimeout(window.__t);
    window.__t = setTimeout(update, 60);
  });
  $("#date").addEventListener("change", update);
  $("#now").addEventListener("click", setNow);
  document.querySelectorAll('input[name="mode"]').forEach((el) => el.addEventListener("change", update));
  $("#hide-isolated").addEventListener("change", update);
  $("#step-free").addEventListener("change", () => routeFrom !== null && routeTo !== null && computeRoute());
  document.querySelectorAll("[data-jump]").forEach((b) => b.addEventListener("click", () => {
    const [lon, lat, z] = b.dataset.jump.split(",").map(Number);
    map.flyTo({ center: [lon, lat], zoom: z });
  }));
  $("#route-toggle").addEventListener("click", () => {
    routeMode = !routeMode;
    $("#route-toggle").classList.toggle("on", routeMode);
    $("#route-toggle").textContent = routeMode ? "経路検索を終了" : "地下経路を検索";
    map.getCanvas().style.cursor = routeMode ? "crosshair" : "";
    clearRoute();
  });
  $("#panel-toggle").addEventListener("click", () => {
    document.body.classList.toggle("panel-hidden");
    map.resize();
  });

  map.on("click", (ev) => {
    if (routeMode) {
      handleRouteClick(ev.lngLat);
      return;
    }
    const bbox = [[ev.point.x - 6, ev.point.y - 6], [ev.point.x + 6, ev.point.y + 6]];
    const acc = map.queryRenderedFeatures(bbox, { layers: ["access"] });
    if (acc.length) return accessPopup(acc[0].id, ev.lngLat);
    const edges = map.queryRenderedFeatures(bbox, { layers: ["net-hit"] }).filter((f) => {
      const st = net.edgeState[f.id];
      return st === 2 || (st === 1 && !$("#hide-isolated").checked) || (st === 0 && mode() === "closed");
    });
    if (edges.length) return edgePopup(edges[0].id, ev.lngLat);
    const pois = map.queryRenderedFeatures(bbox, { layers: ["facility", "station", "ferry-terminal", "bus-stop", "rail-colour", "rail-casing", "bus-route"].filter((id) => map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none") });
    if (pois.length) facilityPopup(pois[0], ev.lngLat);
  });
  for (const id of ["access", "net-hit", "facility", "station", "ferry-terminal", "bus-stop"]) {
    map.on("mouseenter", id, () => { if (!routeMode) map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", id, () => { if (!routeMode) map.getCanvas().style.cursor = ""; });
  }
  setNow();
  document.body.classList.add("ready");
}

init().catch((e) => {
  console.error(e);
  $("#stats").textContent = `読み込みに失敗しました: ${e.message}`;
});
