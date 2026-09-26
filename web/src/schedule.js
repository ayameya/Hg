import { isHoliday } from "./holidays.js";

export const DAY_TYPES = ["月", "火", "水", "木", "金", "土", "日", "祝"];

export function dayType(date) {
  return isHoliday(date) ? 7 : (date.getDay() + 6) % 7;
}

export function isOpen(week, date) {
  if (!week) return true;
  const list = week[dayType(date)];
  const m = date.getHours() * 60 + date.getMinutes();
  for (const [a, b] of list) if (m >= a && m < b) return true;
  return false;
}

export function nextChange(week, date) {
  if (!week) return null;
  const open = isOpen(week, date);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const m0 = date.getHours() * 60 + date.getMinutes();
  for (let day = 0; day < 8; day++) {
    const d = new Date(start);
    d.setDate(d.getDate() + day);
    const list = week[dayType(d)];
    const edges = [];
    for (const [a, b] of list) edges.push(a, b);
    edges.push(0, 1440);
    edges.sort((x, y) => x - y);
    for (const e of edges) {
      if (day === 0 && e <= m0) continue;
      const t = new Date(d);
      t.setMinutes(e);
      if (isOpen(week, t) !== open) return t;
    }
  }
  return null;
}

export function describe(week) {
  if (!week) return "不明";
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const text = week.map((l) => (l.length ? l.map(([a, b]) => `${fmt(a)}-${fmt(b)}`).join(",") : "閉"));
  if (text.every((t) => t === text[0])) return text[0] === "00:00-24:00" ? "終日" : `毎日 ${text[0]}`;
  const groups = [];
  text.forEach((t, i) => {
    const g = groups[groups.length - 1];
    if (g && g.t === t && i !== 7) g.to = i;
    else groups.push({ from: i, to: i, t });
  });
  return groups.map((g) => `${DAY_TYPES[g.from]}${g.to > g.from ? `〜${DAY_TYPES[g.to]}` : ""} ${g.t}`).join(" / ");
}
