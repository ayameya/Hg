import { test } from "node:test";
import assert from "node:assert/strict";
import opening_hours from "opening_hours";
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.TZ = "Asia/Tokyo";

const here = dirname(fileURLToPath(import.meta.url));
async function load(entry) {
  const out = await build({ entryPoints: [join(here, "..", entry)], bundle: true, format: "esm", platform: "node", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
}
const { isHoliday } = await load("src/holidays.js");
const { isOpen, nextChange, describe } = await load("src/schedule.js");
const { compile } = await import("../tools/compile-hours.mjs");

const KNOWN_NATIONAL_REST_DAYS_MISSING_IN_OPENING_HOURS = ["Tue Sep 22 2026", "Tue Sep 21 2032"];
const NOMINATIM = { lat: 35.68, lon: 139.76, address: { country_code: "jp", state: "東京都" } };

test("holiday calculation matches opening_hours.js PH for 2022-2035", () => {
  const ph = new opening_hours("PH", NOMINATIM, { mode: 0 });
  const mismatches = [];
  for (let d = new Date(2022, 0, 1); d < new Date(2036, 0, 1); d.setDate(d.getDate() + 1)) {
    const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
    if (ph.getState(noon) !== isHoliday(noon)) mismatches.push(noon.toDateString());
  }
  assert.deepEqual(mismatches, KNOWN_NATIONAL_REST_DAYS_MISSING_IN_OPENING_HOURS);
});

test("compiled schedules agree with opening_hours.js over sample times", () => {
  const values = ["05:00-01:00", "Mo-Fr 07:00-22:00; Sa 08:00-20:00; Su,PH off", "24/7", "off", "06:00-24:00", "05:30-00:30", "Mo-Sa 07:30-21:00; PH off"];
  for (const v of values) {
    const week = compile(v);
    const oh = new opening_hours(v, NOMINATIM, { mode: 0 });
    for (let d = new Date(2026, 8, 1); d < new Date(2026, 10, 30); d.setMinutes(d.getMinutes() + 37)) {
      const prevHoliday = isHoliday(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
      const crossesMidnight = d.getHours() < 2;
      if (crossesMidnight && (prevHoliday || isHoliday(d))) continue;
      if (KNOWN_NATIONAL_REST_DAYS_MISSING_IN_OPENING_HOURS.includes(d.toDateString())) continue;
      assert.equal(isOpen(week, d), oh.getState(d), `${v} at ${d}`);
    }
  }
});

test("nextChange finds the closing time", () => {
  const week = compile("07:00-23:00");
  const t = nextChange(week, new Date(2026, 8, 30, 12, 0));
  assert.equal(t.getHours(), 23);
  assert.equal(t.getMinutes(), 0);
  const u = nextChange(week, new Date(2026, 8, 30, 23, 30));
  assert.equal(u.getDate(), 1);
  assert.equal(u.getHours(), 7);
});

test("describe summarises a week", () => {
  assert.equal(describe(compile("Mo-Fr 07:00-22:00; Sa,Su,PH off")), "月〜金 07:00-22:00 / 土〜日 閉 / 祝 閉");
  assert.equal(describe(compile("05:00-20:00")), "毎日 05:00-20:00");
  assert.equal(describe(compile("24/7")), "終日");
});
