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

globalThis.fetch = async (url, opts) => {
  const m = /bytes=(\d+)-(\d+)/.exec(opts.headers.Range);
  const start = Number(m[1]);
  const end = Math.min(Number(m[2]), size - 1);
  const buf = Buffer.alloc(end - start + 1);
  readSync(fd, buf, 0, buf.length, start);
  return new Response(buf, { status: 206 });
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
  assert.ok(layers.block.features.length > 100);
  assert.ok(layers.station.features.some((f) => f.props.n === "東京"));
  const road = layers.road.features.find((f) => f.type === 2);
  assert.ok(road.parts[0].length >= 4);
  const low = decodeTile(await p.tile(10, 909, 403));
  assert.ok(low.water && low.ward);
  assert.equal(await p.tile(15, 0, 0), null);
});
