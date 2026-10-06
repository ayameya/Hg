import { test } from "node:test";
import assert from "node:assert/strict";
import { openSync, readSync, statSync } from "node:fs";
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ref from "pmtiles";

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, "..", "..", "docs", "data", "map.pmtiles");
const size = statSync(file).size;
const fd = openSync(file, "r");

const PART = 3 * 699051;
let honorRange = true;
let requests = 0;

function slice(start, end) {
  const buf = Buffer.alloc(end - start + 1);
  readSync(fd, buf, 0, buf.length, start);
  return buf;
}

globalThis.fetch = async (url, opts = {}) => {
  requests++;
  const part = /^part:(\d+)(\.txt)?$/.exec(url);
  const lo = part ? Number(part[1]) * PART : 0;
  const hi = part ? Math.min(size, lo + PART) - 1 : size - 1;
  const m = opts.headers && /bytes=(\d+)-(\d+)/.exec(opts.headers.Range);
  if (part && part[2]) {
    const text = Buffer.from(slice(lo, hi).toString("base64"));
    if (!m || !honorRange) return new Response(text, { status: 200 });
    return new Response(text.subarray(Number(m[1]), Number(m[2]) + 1), { status: 206 });
  }
  if (!m || (part && !honorRange)) return new Response(slice(lo, hi), { status: 200 });
  return new Response(slice(lo + Number(m[1]), Math.min(lo + Number(m[2]), hi)), { status: 206 });
};

async function load(entry) {
  const out = await build({ entryPoints: [join(here, "..", entry)], bundle: true, format: "esm", platform: "node", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
}
const { PMTiles, zxyToTileId } = await load("src/map/pmtiles.js");
const { decodeTile } = await load("src/map/mvt.js");

test("tile ids match the reference implementation", () => {
  for (const [z, x, y] of [[0, 0, 0], [3, 5, 2], [10, 909, 403], [15, 29105, 12903], [15, 29120, 12880]]) {
    assert.equal(zxyToTileId(z, x, y), ref.zxyToTileId(z, x, y));
  }
});

test("tiles decode with expected layers", async () => {
  const p = new PMTiles("file");
  const bytes = await p.tile(15, 29105, 12903);
  assert.ok(bytes && bytes.length > 1000);
  const layers = decodeTile(bytes);
  assert.ok(layers.road.features.length > 100);
  assert.ok(layers.bld.features.length > 100);
  assert.ok(layers.station.features.some((f) => f.props.n === "東京"));
  const road = layers.road.features.find((f) => f.type === 2);
  assert.ok(road.parts[0].length >= 4);
  const low = decodeTile(await p.tile(10, 909, 403));
  assert.ok(low.water && low.ward);
  assert.equal(await p.tile(15, 0, 0), null);
});

test("split archives read the same tiles with and without range support", async () => {
  const whole = new PMTiles("file");
  const ids = [[15, 29105, 12903], [14, 14552, 6451], [10, 909, 403], [15, 29120, 12880]];
  const expected = await Promise.all(ids.map(([z, x, y]) => whole.tile(z, x, y)));
  for (const [honor, base64] of [[true, false], [false, false], [true, true], [false, true]]) {
    honorRange = honor;
    requests = 0;
    const split = new PMTiles("unused", base64 ? { url: "part:", size: PART, base64: true, suffix: ".txt" } : { url: "part:", size: PART });
    for (let i = 0; i < ids.length; i++) {
      const got = await split.tile(...ids[i]);
      assert.deepEqual(got && Buffer.from(got), expected[i] && Buffer.from(expected[i]));
    }
    assert.equal(split.noRange, !honor);
  }
  honorRange = true;
});
