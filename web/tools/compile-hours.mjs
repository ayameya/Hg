import { readFileSync, writeFileSync } from "node:fs";
import opening_hours from "opening_hours";

process.env.TZ = "Asia/Tokyo";

const NOMINATIM = { lat: 35.68, lon: 139.76, address: { country_code: "jp", state: "東京都" } };
const WEEK_START = new Date(2026, 5, 8);
const HOLIDAY = new Date(2026, 6, 20);

function dayIntervals(oh, day) {
  const from = new Date(day);
  const to = new Date(day);
  to.setDate(to.getDate() + 1);
  const out = [];
  for (const [a, b] of oh.getOpenIntervals(from, to)) {
    const s = Math.round((a - from) / 60000);
    const e = Math.round((b - from) / 60000);
    if (e > s) out.push([s, Math.min(e, 1440)]);
  }
  return out;
}

export function compile(value) {
  let oh;
  try {
    oh = new opening_hours(value, NOMINATIM, { mode: 0, warnings_severity: 0 });
  } catch (e) {
    return null;
  }
  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(WEEK_START);
    d.setDate(d.getDate() + i);
    week.push(dayIntervals(oh, d));
  }
  week.push(dayIntervals(oh, HOLIDAY));
  return week;
}

const path = process.argv[2];
if (path) {
  const net = JSON.parse(readFileSync(path, "utf-8"));
  const failed = [];
  net.schedules = net.oh.map((s) => {
    const w = compile(s);
    if (!w) failed.push(s);
    return w;
  });
  writeFileSync(path, JSON.stringify(net));
  console.log("compiled", net.oh.length, "schedules; unparsable:", failed.length, failed.slice(0, 5));
}
