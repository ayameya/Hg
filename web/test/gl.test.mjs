import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, openSync, readSync, statSync } from "node:fs";
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
async function load(entry) {
  const out = await build({ entryPoints: [join(here, "..", entry)], bundle: true, format: "esm", platform: "node", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
}
const { FillBuilder, LineBuilder, groupRings, LINE_STRIDE } = await load("src/gl/tess.js");

function triArea(pos, idx) {
  let s = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
    s += Math.abs((pos[2 * b] - pos[2 * a]) * (pos[2 * c + 1] - pos[2 * a + 1]) - (pos[2 * c] - pos[2 * a]) * (pos[2 * b + 1] - pos[2 * a + 1])) / 2;
  }
  return s;
}

test("polygon with a hole triangulates to the right area", () => {
  const f = new FillBuilder();
  const outer = [0, 0, 100, 0, 100, 100, 0, 100, 0, 0];
  const hole = [25, 25, 25, 75, 75, 75, 75, 25, 25, 25];
  f.addPolygon([outer, hole], true);
  assert.equal(Math.round(triArea(f.pos.final(), f.idx.final())), 10000 - 2500);
  assert.equal(f.outline.length, 16);
});

test("rings group into polygons using the first ring's winding", () => {
  const cw = [0, 0, 10, 0, 10, 10, 0, 10, 0, 0];
  const ccw = [2, 2, 2, 8, 8, 8, 8, 2, 2, 2];
  const other = [20, 20, 30, 20, 30, 30, 20, 30, 20, 20];
  const polys = groupRings([cw, ccw, other]);
  assert.equal(polys.length, 2);
  assert.equal(polys[0].length, 2);
});

test("line tessellation emits two vertices per point with unit normals and miters", () => {
  const l = new LineBuilder();
  l.addLine([0, 0, 10, 0, 10, 10]);
  const v = l.v.final();
  assert.equal(v.length / LINE_STRIDE, 6);
  assert.equal(l.idx.length, 12);
  const corner = 2 * LINE_STRIDE;
  const ex = v[corner + 2];
  const ey = v[corner + 3];
  assert.ok(Math.abs(Math.hypot(ex, ey) - Math.SQRT2) < 1e-6);
  assert.equal(v[4 * LINE_STRIDE + 5], 20);
  l.addLine([5, 5, 5, 5]);
  assert.equal(l.v.length / LINE_STRIDE, 6);
});

const PM = join(here, "..", "..", "docs", "data", "map.pmtiles");
test("a dense Tokyo tile builds GPU buffers quickly", { skip: !existsSync(PM) }, async () => {
  const size = statSync(PM).size;
  const fd = openSync(PM, "r");
  globalThis.fetch = async (url, opts) => {
    const m = /bytes=(\d+)-(\d+)/.exec(opts.headers.Range);
    const start = Number(m[1]);
    const end = Math.min(Number(m[2]), size - 1);
    const buf = Buffer.alloc(end - start + 1);
    readSync(fd, buf, 0, buf.length, start);
    return new Response(buf, { status: 206 });
  };
  const { PMTiles } = await load("src/map/pmtiles.js");
  const { decodeTile } = await load("src/map/mvt.js");
  const { buildTile } = await load("src/gl/tilebuild.js");
  const p = new PMTiles("file");
  const bytes = await p.tile(15, 29105, 12903);
  const layers = decodeTile(bytes);
  const t0 = performance.now();
  const data = buildTile(layers);
  const ms = performance.now() - t0;
  const bld = data.fill.ranges.filter((r) => r.layer === "building");
  const tris = bld.reduce((s, r) => s + r.count / 3, 0);
  console.log(`tile 15/29105/12903: ${layers.bld ? layers.bld.features.length : 0} buildings, ${tris} building triangles, ${data.line.v.length / LINE_STRIDE} line vertices, built in ${ms.toFixed(1)} ms, ${(data.fill.pos.byteLength + data.fill.idx.byteLength + data.line.v.byteLength + data.line.idx.byteLength) / 1024 | 0} KB`);
  assert.ok(tris > 500);
  assert.ok(bld.some((r) => r.key === "u" && r.count > 0), "entrance buildings present");
  assert.ok(ms < 400);
});
