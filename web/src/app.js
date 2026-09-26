import { MapView, bearing } from "./map/map.js";
import { PMTiles } from "./map/pmtiles.js";
import { Network, meters } from "./network.js";
import { Positioning } from "./positioning.js";
import { describe } from "./schedule.js";
import { CAT_COLORS, CAT_LABELS, FACILITY, style } from "./style.js";

const $ = (s) => document.querySelector(s);
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const DIRS = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
const SRC_LABELS = { osm: "OpenStreetMap", override: "個別ルール", ekitan: "駅探の出口情報", default: "種別ごとの推定値", virtual: "仮接続" };
const CONF_LABELS = { high: "高", medium: "中", low: "低" };
const HW_LABELS = { steps: "階段", elevator: "エレベーター", footway: "通路", corridor: "屋内通路", pedestrian: "歩行者空間", path: "小径", virtual: "仮接続" };
const WALK_MPM = 75;

const base = new URL(".", location.href);
const state = {
  follow: true,
  mode: "open",
  hideIsolated: true,
  stepFree: false,
  preferUnderground: true,
  target: null,
  destination: null,
  plan: null,
  origin: null,
};

const map = new MapView($("#map"), {
  source: new PMTiles(new URL("data/map.pmtiles", base).href),
  style,
  center: [139.7671, 35.6812],
  origin: [139.74, 35.68],
  zoom: 15,
  minZoom: 10,
  maxZoom: 19.5,
  bounds: [139.5, 35.48, 139.98, 35.85],
});

let net = null;
let pos = null;
let areas = null;
let overlayCache = null;

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

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

const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDate = (d) => `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]}) ${fmtTime(d)}`;
const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m / 10) * 10 || Math.round(m)}m`);
const dirName = (b) => DIRS[Math.round(b / 45) % 8];

function syncNow() {
  const now = tokyoNow();
  $("#date").value = now.date;
  $("#time").value = String(now.minutes);
}

function updateTimeLabels() {
  const d = currentDate();
  const kind = net && net.isHoliday(d) ? "祝日" : d.getDay() === 0 ? "日曜" : d.getDay() === 6 ? "土曜" : "平日";
  $("#time-label").textContent = fmtTime(d);
  $("#day-kind").textContent = `${WEEK[d.getDay()]}曜・${kind}`;
  $("#time-chip").textContent = `${state.follow ? "現在 " : ""}${fmtTime(d)}${state.mode === "all" ? "（全表示）" : ""}`;
  $("#time-chip").classList.toggle("custom", !state.follow);
}

function update() {
  if (!net) return;
  updateTimeLabels();
  const res = net.evaluate(currentDate(), state.mode === "all");
  overlayCache = null;
  const km = (x) => (x / 1000).toFixed(1);
  $("#stats").innerHTML = state.mode === "all"
    ? `全区間 <b>${km(res.totalLen)} km</b>（時刻を無視）`
    : `通行可 <b>${km(res.reachLen)} km</b> / 全 ${km(res.totalLen)} km<br><span class="muted">地上から入れない ${km(res.openLen - res.reachLen)} km・閉鎖 ${km(res.totalLen - res.openLen)} km</span>`;
  if (state.destination) replan();
  refreshGuide();
  map.render();
}

function buildOverlayPaths() {
  const { ef } = net;
  const buckets = new Map();
  const get = (k) => {
    if (!buckets.has(k)) buckets.set(k, new Path2D());
    return buckets.get(k);
  };
  net.edges.forEach((e, i) => {
    const st = net.edgeState[i];
    let key;
    if (st === 2) key = e[ef.highway] === "virtual" ? "virtual" : `open:${e[ef.cat]}`;
    else if (st === 1) key = state.hideIsolated ? null : "isolated";
    else key = state.mode === "closed" ? "closed" : null;
    if (!key) return;
    const p = get(key);
    const cs = e[ef.coords];
    let [x, y] = map.toLocal(cs[0][0], cs[0][1]);
    p.moveTo(x, y);
    for (let j = 1; j < cs.length; j++) {
      [x, y] = map.toLocal(cs[j][0], cs[j][1]);
      p.lineTo(x, y);
    }
  });
  let areaPath = null;
  if (areas) {
    areaPath = new Path2D();
    for (const f of areas.features) {
      const rings = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of rings) for (const ring of poly) {
        ring.forEach((c, j) => {
          const [x, y] = map.toLocal(c[0], c[1]);
          if (j) areaPath.lineTo(x, y);
          else areaPath.moveTo(x, y);
        });
        areaPath.closePath();
      }
    }
  }
  return { buckets, areaPath };
}

function lineWidth(z) {
  return z < 13 ? 1.2 : z < 15 ? 2 : z < 17 ? 3.2 : z < 18 ? 5 : 7;
}

const networkOverlay = {
  draw(ctx, view) {
    if (!net) return;
    if (!overlayCache) overlayCache = buildOverlayPaths();
    const { s, ox, oy } = view.localTransform();
    const dpr = view.dpr;
    ctx.save();
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const w = lineWidth(view.zoom);
    if (overlayCache.areaPath && view.zoom >= 15) {
      ctx.fillStyle = "rgba(109,143,179,0.16)";
      ctx.fill(overlayCache.areaPath);
    }
    const stroke = (key, color, width, dash) => {
      const p = overlayCache.buckets.get(key);
      if (!p) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width / s;
      ctx.setLineDash(dash ? dash.map((d) => d / s) : []);
      ctx.stroke(p);
    };
    stroke("closed", "rgba(194,59,59,0.75)", Math.max(1, w * 0.6), [2, 3]);
    stroke("isolated", "rgba(140,140,140,0.8)", w);
    for (const cat of Object.keys(CAT_COLORS)) stroke(`open:${cat}`, "#ffffff", w + 2.4);
    for (const cat of Object.keys(CAT_COLORS)) stroke(`open:${cat}`, CAT_COLORS[cat], w);
    stroke("virtual", "rgba(31,111,209,0.7)", Math.max(1, w * 0.5), [3, 3]);
    if (state.plan && state.plan.underground) {
      const u = state.plan.underground;
      const route = new Path2D();
      u.line.forEach((c, j) => {
        const [x, y] = map.toLocal(c[0], c[1]);
        if (j) route.lineTo(x, y);
        else route.moveTo(x, y);
      });
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(255,196,0,0.9)";
      ctx.lineWidth = (w + 6) / s;
      ctx.stroke(route);
      const legs = new Path2D();
      const from = state.plan.from;
      const entry = net.nodes[u.entry];
      const exit = net.nodes[u.exit];
      const to = state.destination;
      const seg = (a, b) => {
        const [x1, y1] = map.toLocal(a[0], a[1]);
        const [x2, y2] = map.toLocal(b[0], b[1]);
        legs.moveTo(x1, y1);
        legs.lineTo(x2, y2);
      };
      if (from && !u.fromSnap) seg(from, [entry[0], entry[1]]);
      seg([exit[0], exit[1]], [to.lon, to.lat]);
      ctx.strokeStyle = "rgba(90,90,90,0.8)";
      ctx.lineWidth = 2.5 / s;
      ctx.setLineDash([2 / s, 5 / s]);
      ctx.stroke(legs);
    }
    ctx.restore();
  },
  labels(view, out) {
    if (!net || view.zoom < 14.5) return;
    const { nf } = net;
    const date = currentDate();
    for (const i of net.entrances) {
      const n = net.nodes[i];
      const [x, y] = view.toScreen(n[0], n[1]);
      if (x < -20 || y < -20 || x > view.w + 20 || y > view.h + 20) continue;
      const open = state.mode === "all" || net.entranceUsable(i);
      if (!open && state.mode === "open") continue;
      const isTarget = state.target === i || (state.plan?.underground && (state.plan.underground.entry === i || state.plan.underground.exit === i));
      const label = n[nf.ref] || (n[nf.flags] & 4 ? "EV" : "");
      out.push({
        x, y,
        priority: isTarget ? 0 : 2,
        radius: view.zoom >= 16.5 ? 6 : 4.5,
        color: open ? (n[nf.flags] & 8 ? "#555" : "#111") : "#fff",
        ring: open ? "#fff" : "#c23b3b",
        ringWidth: 2,
        glyph: view.zoom >= 16.5 && !label ? "入" : null,
        text: view.zoom >= 16 ? label : null,
        font: "700 12px system-ui, sans-serif",
        size: 12,
        textColor: open ? "#111" : "#c23b3b",
        force: isTarget,
        feature: { layer: "entrance", index: i, date },
      });
    }
  },
  drawTop(ctx, view) {
    const p = pos && pos.raw;
    if (state.destination) {
      const [x, y] = view.toScreen(state.destination.lon, state.destination.lat);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y - 16, 8, Math.PI * 0.75, Math.PI * 2.25);
      ctx.closePath();
      ctx.fillStyle = "#c23b3b";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y - 16, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }
    if (!p) return;
    const [rx, ry] = view.toScreen(p.lon, p.lat);
    if (p.accuracy) {
      const r = (p.accuracy / (156543.03 * Math.cos((p.lat * Math.PI) / 180))) * 2 ** view.zoom * 2;
      ctx.beginPath();
      ctx.arc(rx, ry, Math.min(r, 400), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(31,111,209,0.10)";
      ctx.fill();
    }
    const at = pos.position;
    const [x, y] = view.toScreen(at.lon, at.lat);
    if (pos.snapped) {
      ctx.beginPath();
      ctx.arc(rx, ry, 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(90,90,90,0.6)";
      ctx.fill();
    }
    if (pos.heading != null) {
      const a = ((pos.heading - 90) * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, 34, a - 0.45, a + 0.45);
      ctx.closePath();
      ctx.fillStyle = "rgba(31,111,209,0.25)";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#1f6fd1";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    if (at.level != null && at.level < 0) {
      ctx.font = "700 11px system-ui, sans-serif";
      ctx.fillStyle = "#1f6fd1";
      ctx.fillText(`B${Math.abs(at.level)}`, x + 11, y - 10);
    }
  },
};
map.overlays.push(networkOverlay);

function referencePoint() {
  if (pos && pos.position) return { ...pos.position, real: true };
  const [lon, lat] = map.getCenter();
  return { lon, lat, level: null, real: false };
}

function arrowDeg(b) {
  return pos && pos.heading != null ? (b - pos.heading + 360) % 360 : b;
}

function entranceTitle(i) {
  const n = net.node(i);
  const st = n.station || "";
  if (n.name && n.ref && n.name.includes(n.ref)) return n.name;
  return [st, n.ref || (n.flags & 4 ? "エレベーター" : "出入口")].filter(Boolean).join(" ");
}

function entranceHours(i, date) {
  const n = net.node(i);
  if (n.oh < 0) return n.flags & 8 ? "時間情報なし" : "通路の時間に準じる";
  const open = net.ohOpen(n.oh, date);
  const next = net.nextChange(n.oh, date);
  if (!next) return open ? "終日" : "閉鎖中";
  return open ? `${fmtTime(next)}まで` : `${fmtDate(next)}から`;
}

function refreshGuide() {
  if (!net) return;
  const ref = referencePoint();
  const date = currentDate();
  const box = $("#guide");
  const head = ref.real ? (pos.raw.source === "gps" ? "現在地（GPS）" : `現在地（${escapeHtml(pos.raw.source)}）`) : "地図の中心";
  let html = "";
  if (state.destination && state.plan) {
    html += planHtml(ref, date);
  } else if (state.target != null) {
    const n = net.nodes[state.target];
    const d = meters([ref.lon, ref.lat], [n[0], n[1]]);
    const b = bearing([ref.lon, ref.lat], [n[0], n[1]]);
    html += `<div class="target"><div class="arrow big" style="transform:rotate(${arrowDeg(b)}deg)">↑</div><div><div class="t-title">${escapeHtml(entranceTitle(state.target))}</div><div>${dirName(b)}へ <b>${fmtDist(d)}</b>・徒歩${Math.max(1, Math.round(d * 1.25 / WALK_MPM))}分</div><div class="muted">${escapeHtml(entranceHours(state.target, date))}</div></div><button class="link" data-act="clear-target">×</button></div>`;
  }
  const near = net.nearestEntrances(ref.lon, ref.lat, 3);
  html += `<div class="g-head">${head}から近い入口${pos && pos.heading != null ? "（矢印は進行方向基準）" : "（矢印は北が上）"}</div>`;
  if (!near.length) html += '<div class="muted">1.5km以内に地下への入口が見つかりません。</div>';
  html += near.map(({ index, dist, open }) => {
    const n = net.nodes[index];
    const b = bearing([ref.lon, ref.lat], [n[0], n[1]]);
    return `<button class="ent ${open ? "" : "closed"}" data-ent="${index}"><span class="arrow" style="transform:rotate(${arrowDeg(b)}deg)">↑</span><span class="e-name">${escapeHtml(entranceTitle(index))}</span><span class="e-dist">${dirName(b)} ${fmtDist(dist)}</span><span class="e-hours">${open ? escapeHtml(entranceHours(index, date)) : "閉鎖中"}</span></button>`;
  }).join("");
  box.innerHTML = html;
  document.documentElement.style.setProperty("--sheet-h", `${$("#sheet").offsetHeight}px`);
}

function planHtml(ref, date) {
  const p = state.plan;
  const u = p.underground;
  const dest = escapeHtml(state.destination.name || "目的地");
  const directMin = Math.round(p.direct / WALK_MPM);
  let html = `<div class="plan"><div class="p-head"><b>${dest}</b>へ<button class="link" data-act="clear-dest">×</button></div>`;
  if (!u) {
    html += `<div>この時刻に使える地下経路はありません。地上で約${fmtDist(p.direct)}・${directMin}分。</div></div>`;
    return html;
  }
  const entry = u.fromSnap ? "現在地（地下）" : entranceTitle(u.entry);
  const exit = entranceTitle(u.exit);
  const total = Math.round(u.totalMeters / WALK_MPM);
  const ratio = Math.round((u.undergroundMeters / u.totalMeters) * 100);
  const nextPt = nextWaypoint(ref);
  if (nextPt && ref.real) {
    const d = meters([ref.lon, ref.lat], nextPt.c);
    const b = bearing([ref.lon, ref.lat], nextPt.c);
    html += `<div class="target"><div class="arrow big" style="transform:rotate(${arrowDeg(b)}deg)">↑</div><div><div class="t-title">${escapeHtml(nextPt.label)}</div><div>${dirName(b)}へ <b>${fmtDist(d)}</b></div></div></div>`;
  }
  html += `<ol class="steps">`;
  if (!u.fromSnap) html += `<li>地上 ${fmtDist(u.entryWalk)} → <b>${escapeHtml(entry)}</b>（${escapeHtml(entranceHours(u.entry, date))}）</li>`;
  html += `<li>地下 <b>${fmtDist(u.undergroundMeters)}</b></li>`;
  html += `<li><b>${escapeHtml(exit)}</b> → 地上 ${fmtDist(u.exitWalk)}</li></ol>`;
  html += `<div class="muted">合計 約${fmtDist(u.totalMeters)}・${total}分（地下 ${ratio}%）／地上のみ 約${fmtDist(p.direct)}・${directMin}分</div></div>`;
  return html;
}

function nextWaypoint(ref) {
  const u = state.plan && state.plan.underground;
  if (!u) return null;
  const entry = net.nodes[u.entry];
  const exit = net.nodes[u.exit];
  const here = [ref.lon, ref.lat];
  const onRoute = pos && pos.snapped && u.edges.includes(pos.snapped.edge);
  if (!u.fromSnap && !onRoute && meters(here, [entry[0], entry[1]]) > 25 && !state.passedEntry) return { c: [entry[0], entry[1]], label: `入口 ${entranceTitle(u.entry)}` };
  state.passedEntry = true;
  if (meters(here, [exit[0], exit[1]]) > 25 && !state.passedExit) {
    if (onRoute) {
      const line = u.line;
      let best = 0;
      let bd = Infinity;
      line.forEach((c, j) => {
        const d = meters(here, c);
        if (d < bd) {
          bd = d;
          best = j;
        }
      });
      let k = best;
      while (k < line.length - 1 && meters(here, line[k]) < 20) k++;
      return { c: line[k], label: `地下を進む（出口 ${entranceTitle(u.exit)} まで ${fmtDist(meters(here, [exit[0], exit[1]]))}）` };
    }
    return { c: [exit[0], exit[1]], label: `出口 ${entranceTitle(u.exit)}` };
  }
  state.passedExit = true;
  return { c: [state.destination.lon, state.destination.lat], label: state.destination.name || "目的地" };
}

function setDestination(d) {
  state.destination = d;
  state.passedEntry = false;
  state.passedExit = false;
  state.target = null;
  replan();
  refreshGuide();
  document.body.classList.add("sheet-open");
  map.render();
}

function replan() {
  if (!state.destination) {
    state.plan = null;
    return;
  }
  const ref = referencePoint();
  const from = [ref.lon, ref.lat];
  state.plan = { from, ...net.plan(from, [state.destination.lon, state.destination.lat], { stepFree: state.stepFree, preferUnderground: state.preferUnderground, fromLevel: ref.level }) };
  overlayCache = null;
}

function popupAt(lngLat, html) {
  const el = $("#popup");
  el.innerHTML = `<button class="close" aria-label="閉じる">×</button>${html}`;
  el.hidden = false;
  el.dataset.lon = lngLat[0];
  el.dataset.lat = lngLat[1];
  placePopup();
}

function placePopup() {
  const el = $("#popup");
  if (el.hidden) return;
  const [x, y] = map.toScreen(Number(el.dataset.lon), Number(el.dataset.lat));
  const r = $("#map").getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let left = Math.max(8, Math.min(r.width - w - 8, x - w / 2));
  let top = y - h - 14;
  if (top < 8) top = y + 14;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function stateText(ohIdx, date) {
  const open = net.ohOpen(ohIdx, date);
  const next = net.nextChange(ohIdx, date);
  const nextTxt = next ? `（${fmtDate(next)}に${open ? "閉鎖" : "開放"}）` : "";
  return `<span class="${open ? "ok" : "ng"}">${open ? "通行可" : "閉鎖"}</span>${nextTxt}`;
}

function basisHtml(src, conf, rule, note) {
  const link = rule && rule.source ? ` <a href="${escapeHtml(rule.source)}" target="_blank" rel="noopener">出典</a>` : "";
  return `${SRC_LABELS[src] || src}${conf ? `（確度: ${CONF_LABELS[conf] || conf}）` : ""}${rule ? `<br>${escapeHtml(rule.name || rule.id)}${link}` : ""}${note ? `<br><span class="muted">${escapeHtml(note)}</span>` : ""}`;
}

function edgePopup(i, lngLat) {
  const e = net.edge(i);
  const date = currentDate();
  const levelTxt = e.level < 0 ? `B${Math.abs(e.level)}` : e.level === 0 ? "地上" : `${e.level}F`;
  const rule = e.rule ? net.rules[e.rule] : null;
  const warn = net.edgeState[i] === 1 ? '<div class="warn">通路は開いていますが、つながる地上出入口がすべて閉鎖されています。</div>' : "";
  popupAt(lngLat, `
    <div class="pp-title"><span class="dot" style="background:${CAT_COLORS[e.cat]}"></span>${escapeHtml(e.name || HW_LABELS[e.highway] || e.highway)}</div>
    <table>
      <tr><th>種別</th><td>${CAT_LABELS[e.cat]}${e.connector ? "（地上との接続）" : ""}・${escapeHtml(HW_LABELS[e.highway] || e.highway)}</td></tr>
      <tr><th>階層</th><td>${levelTxt}</td></tr>
      <tr><th>通行時間</th><td>${escapeHtml(describe(net.schedule(e.oh)))}</td></tr>
      <tr><th>選択時刻</th><td>${stateText(e.oh, date)}</td></tr>
      <tr><th>根拠</th><td>${basisHtml(e.src, e.conf, rule, net.notes[e.note])}</td></tr>
      ${e.wheelchair ? `<tr><th>車いす</th><td>${escapeHtml(e.wheelchair)}</td></tr>` : ""}
      <tr><th>延長</th><td>${e.len.toFixed(0)} m</td></tr>
    </table>${warn}
    <div class="pp-foot">${e.way ? `<a href="https://www.openstreetmap.org/way/${e.way}" target="_blank" rel="noopener">OSM way/${e.way}</a>` : ""}</div>`);
}

function entrancePopup(i) {
  const n = net.node(i);
  const date = currentDate();
  const rule = n.rule ? net.rules[n.rule] : null;
  const kind = n.flags & 4 ? "エレベーター" : "出入口";
  const hours = n.oh >= 0
    ? `<tr><th>利用時間</th><td>${escapeHtml(describe(net.schedule(n.oh)))}<br>${stateText(n.oh, date)}</td></tr><tr><th>根拠</th><td>${basisHtml(n.src, rule?.confidence, rule, rule?.note)}</td></tr>`
    : `<tr><th>利用時間</th><td class="muted">${n.flags & 8 ? "情報なし" : "つながる通路の時間に準じる"}</td></tr>`;
  const usable = state.mode === "all" || net.entranceUsable(i);
  const iso = n.flags & 8 ? '<div class="warn">OSMにこの入口の先の地下通路がないため、経路には使えません。</div>' : "";
  popupAt([n.lon, n.lat], `
    <div class="pp-title">${escapeHtml(entranceTitle(i))}</div>
    <table>
      <tr><th>種別</th><td>${kind}${n.station ? `（${escapeHtml(n.station)}駅付近）` : ""}</td></tr>
      ${hours}
      <tr><th>選択時刻</th><td><span class="${usable ? "ok" : "ng"}">${usable ? "利用可" : "利用不可"}</span></td></tr>
    </table>${iso}
    <div class="pp-actions"><button data-act="guide-ent" data-i="${i}">ここへ案内</button></div>
    <div class="pp-foot"><a href="https://www.openstreetmap.org/node/${n.osm_id}" target="_blank" rel="noopener">OSM node/${n.osm_id}</a></div>`);
}

function featurePopup(f, lngLat) {
  const p = f.props;
  let title = p.n || "";
  let kind = "";
  const extra = [];
  if (f.layer === "facility") {
    const g = FACILITY[p.g];
    kind = `${g ? g.label : p.g}${p.a ? `（${escapeHtml(p.a)}）` : ""}`;
    if (p.ad) extra.push(`<div>${escapeHtml(p.ad)}</div>`);
    if (p.h) extra.push(`<div>営業・開館: <code>${escapeHtml(p.h)}</code></div>`);
    if (p.co) extra.push(`<div>国・地域: ${escapeHtml(p.co)}</div>`);
    if (p.w) extra.push(`<div><a href="${escapeHtml(p.w)}" target="_blank" rel="noopener">Web</a></div>`);
    const src = p.src === "ksj" ? `国土数値情報（${escapeHtml(p.r)}）` : p.r ? `<a href="https://www.openstreetmap.org/${escapeHtml(p.r)}" target="_blank" rel="noopener">OSM ${escapeHtml(p.r)}</a>` : "";
    if (src) extra.push(`<div class="pp-foot">${src}</div>`);
  } else if (f.layer === "station") {
    kind = `駅${p.o ? `・${escapeHtml(p.o)}` : ""}`;
  } else if (f.layer === "ferry") {
    kind = "船着場";
  } else if (f.layer === "bstop") {
    kind = "バス停";
  }
  popupAt(lngLat, `<div class="pp-title">${escapeHtml(title || kind)}</div><div>${kind}</div>${extra.join("")}
    <div class="pp-actions"><button data-act="go" data-lon="${lngLat[0]}" data-lat="${lngLat[1]}" data-name="${escapeHtml(title || kind)}">ここへ行く（地下優先）</button></div>`);
}

function pickEdge(x, y) {
  const [lon, lat] = map.fromScreen(x, y);
  const mpp = (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** map.zoom / 2;
  const s = net.snap(lon, lat, { maxMeters: Math.max(3, mpp * 10) });
  if (!s) return null;
  const st = net.edgeState[s.edge];
  if (st === 2 || (st === 1 && !state.hideIsolated) || (st === 0 && state.mode === "closed") || state.mode === "all") return s;
  return null;
}

map.on("click", (ev) => {
  if (!net) return;
  const hit = map.pickLabel(ev.x, ev.y);
  if (hit && hit.feature && hit.feature.layer === "entrance") return entrancePopup(hit.feature.index);
  const edge = pickEdge(ev.x, ev.y);
  if (hit && hit.feature) {
    const lngLat = map.fromScreen(hit.x, hit.y);
    return featurePopup(hit.feature, lngLat);
  }
  if (edge) return edgePopup(edge.edge, [edge.lon, edge.lat]);
  $("#popup").hidden = true;
});
map.on("move", () => {
  placePopup();
  if (!pos || !pos.raw) {
    clearTimeout(state.guideTimer);
    state.guideTimer = setTimeout(refreshGuide, 150);
  }
});

document.addEventListener("click", (ev) => {
  const t = ev.target.closest("[data-act], [data-ent], .close, [data-jump]");
  if (!t) return;
  if (t.classList.contains("close")) {
    $("#popup").hidden = true;
    return;
  }
  if (t.dataset.ent) {
    state.target = Number(t.dataset.ent);
    const n = net.nodes[state.target];
    if (!pos || !pos.raw) map.flyTo([n[0], n[1]], Math.max(map.zoom, 17));
    refreshGuide();
    map.render();
    return;
  }
  if (t.dataset.jump) {
    const [lon, lat, z] = t.dataset.jump.split(",").map(Number);
    map.flyTo([lon, lat], z);
    return;
  }
  const act = t.dataset.act;
  if (act === "clear-target") state.target = null;
  if (act === "clear-dest") {
    state.destination = null;
    state.plan = null;
    overlayCache = null;
  }
  if (act === "guide-ent") {
    state.target = Number(t.dataset.i);
    state.destination = null;
    state.plan = null;
    $("#popup").hidden = true;
    document.body.classList.add("sheet-open");
  }
  if (act === "go") {
    $("#popup").hidden = true;
    setDestination({ lon: Number(t.dataset.lon), lat: Number(t.dataset.lat), name: t.dataset.name });
  }
  refreshGuide();
  map.render();
});

let searchRows = null;
const kana = (s) => s.normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\s・]/g, "");
async function runSearch() {
  const q = kana($("#search").value.trim());
  const box = $("#results");
  if (!q) {
    box.hidden = true;
    return;
  }
  if (!searchRows) {
    box.hidden = false;
    box.innerHTML = '<div class="muted">読み込み中…</div>';
    const rows = await fetch(new URL("data/search.json", base)).then((r) => r.json());
    searchRows = rows.map((r) => [...r, kana(r[0])]);
  }
  const [clon, clat] = map.getCenter();
  const hits = [];
  for (const r of searchRows) {
    const i = r[5].indexOf(q);
    if (i < 0) continue;
    const score = (i === 0 ? 0 : 1) + (r[1] === "station" ? -0.5 : 0) + meters([clon, clat], [r[2], r[3]]) / 20000;
    hits.push([score, r]);
  }
  hits.sort((a, b) => a[0] - b[0]);
  const label = (k) => (k === "station" ? "駅" : k === "exit" ? "出口" : FACILITY[k]?.label || k);
  box.innerHTML = hits.slice(0, 30).map(([, r]) => `<button data-r='${escapeHtml(JSON.stringify(r.slice(0, 4)))}'><span>${escapeHtml(r[0])}</span><small>${escapeHtml(label(r[1]))}${r[4] ? `・${escapeHtml(r[4])}` : ""}</small></button>`).join("") || '<div class="muted">見つかりません</div>';
  box.hidden = false;
}
$("#search").addEventListener("input", () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(runSearch, 200);
});
$("#results").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-r]");
  if (!b) return;
  const [name, kind, lon, lat] = JSON.parse(b.dataset.r);
  $("#results").hidden = true;
  $("#search").value = name;
  map.flyTo([lon, lat], Math.max(map.zoom, 17));
  setDestination({ lon, lat, name, kind });
});

function setupPanel() {
  $("#menu").addEventListener("click", () => document.body.classList.toggle("panel-open"));
  $("#panel-close").addEventListener("click", () => document.body.classList.remove("panel-open"));
  $("#time-chip").addEventListener("click", () => document.body.classList.add("panel-open"));
  $("#sheet-toggle").addEventListener("click", () => document.body.classList.toggle("sheet-open"));
  $("#time").addEventListener("input", () => {
    state.follow = false;
    updateTimeLabels();
    clearTimeout(state.t);
    state.t = setTimeout(update, 60);
  });
  $("#date").addEventListener("change", () => {
    state.follow = false;
    update();
  });
  $("#now").addEventListener("click", () => {
    state.follow = true;
    syncNow();
    update();
  });
  document.querySelectorAll('input[name="mode"]').forEach((el) => el.addEventListener("change", () => {
    state.mode = el.value;
    update();
  }));
  $("#hide-isolated").addEventListener("change", (e) => {
    state.hideIsolated = e.target.checked;
    overlayCache = null;
    map.render();
  });
  $("#step-free").addEventListener("change", (e) => {
    state.stepFree = e.target.checked;
    replan();
    refreshGuide();
    map.render();
  });
  $("#prefer-ug").addEventListener("change", (e) => {
    state.preferUnderground = e.target.checked;
    replan();
    refreshGuide();
    map.render();
  });
  $("#fac-list").innerHTML = Object.entries(FACILITY).map(([k, v]) => `<label><input type="checkbox" data-fac="${k}" ${["welfare", "other", "sports"].includes(k) ? "" : "checked"}><span class="sw round" style="background:${v.color}">${v.glyph}</span>${v.label}</label>`).join("");
  const applyLayers = () => {
    map.hidden.clear();
    document.querySelectorAll("[data-group]").forEach((el) => !el.checked && map.hidden.add(el.dataset.group));
    document.querySelectorAll("[data-fac]").forEach((el) => !el.checked && map.hidden.add(`fac:${el.dataset.fac}`));
    map.render();
  };
  document.querySelectorAll("[data-group], [data-fac]").forEach((el) => el.addEventListener("change", applyLayers));
  applyLayers();
  $("#legend-cats").innerHTML = Object.entries(CAT_LABELS).map(([k, v]) => `<div class="lg"><span class="sw" style="background:${CAT_COLORS[k]}"></span>${v}</div>`).join("")
    + '<div class="lg"><span class="sw" style="background:#8c8c8c"></span>開いているが地上から入れない</div><div class="lg"><span class="sw dashed"></span>閉鎖中（表示時のみ）</div><div class="lg"><span class="pt"></span>入口（灰色は通路データなし）</div><div class="lg"><span class="pt closed"></span>閉鎖中の入口</div>';
  $("#locate").addEventListener("click", async () => {
    pos.startGps();
    await pos.startCompass();
    const p = pos.position;
    if (p) map.flyTo([p.lon, p.lat], Math.max(map.zoom, 17));
    state.flyOnFix = !p;
  });
  $("#export-anchors").addEventListener("click", () => {
    const blob = new Blob([pos.exportAnchors()], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ugmap-anchors.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

async function init() {
  syncNow();
  setupPanel();
  const [raw, ar] = await Promise.all([
    fetch(new URL("data/network.json", base)).then((r) => r.json()),
    fetch(new URL("data/areas.json", base)).then((r) => r.json()).catch(() => null),
  ]);
  net = new Network(raw);
  areas = ar;
  pos = new Positioning(net);
  pos.subscribe(() => {
    const p = pos.position;
    if (p && state.flyOnFix) {
      state.flyOnFix = false;
      map.flyTo([p.lon, p.lat], Math.max(map.zoom, 17));
    }
    $("#pos-status").textContent = pos.raw ? `${pos.raw.source}・${pos.raw.lat.toFixed(6)}, ${pos.raw.lon.toFixed(6)}${pos.raw.level != null ? `・階層 ${pos.raw.level}` : ""}${pos.snapped ? `・通路に補正（${pos.snapped.dist.toFixed(1)}m）` : ""}` : pos.error ? `エラー: ${pos.error}` : "未取得";
    if (state.destination && Date.now() - (state.lastPlan || 0) > 5000) {
      state.lastPlan = Date.now();
      replan();
    }
    refreshGuide();
    map.render();
  });
  window.UGMap = {
    version: 1,
    setPosition: (p) => pos.setPosition(p),
    clearPosition: () => pos.clear(),
    onPosition: (fn) => pos.subscribe(() => fn(pos.position)),
    setDestination: (d) => setDestination({ lon: Number(d.lon ?? d.lng), lat: Number(d.lat), name: d.name }),
    snap: (lat, lon, level) => net.snap(lon, lat, { maxMeters: 60, level }),
    exportAnchors: () => pos.exportAnchors(),
    network: net,
  };
  $("#meta").textContent = `地図: ${raw.source}・生成 ${raw.generated.slice(0, 10)}`;
  update();
  setInterval(() => {
    if (state.follow) {
      syncNow();
      update();
    }
  }, 60000);
  document.body.classList.add("ready");
}

init().catch((e) => {
  console.error(e);
  $("#guide").textContent = `読み込みに失敗しました: ${e.message}`;
});
