import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../tools/compile-hours.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bundled = await build({ entryPoints: [join(here, "..", "src", "network.js")], bundle: true, format: "esm", platform: "node", write: false });
const { Network } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function sample() {
  const x = (i) => 139.76 + i * 0.001;
  const edge = (a, b, len, oh, highway = "footway") => [a, b, [[x(a), 35.68], [x(b), 35.68]], len, 1, "station", 0, highway, "", -1, oh, "default", "low", 0, "", ""];
  const oh = ["24/7", "07:00-23:00", "05:00-01:00", "Mo-Fr 08:00-20:00; PH off"];
  return {
    edge_fields: ["a", "b", "coords", "len", "way", "cat", "connector", "highway", "name", "level", "oh", "src", "conf", "note", "rule", "wheelchair"],
    node_fields: ["lon", "lat", "flags", "oh", "ref", "name", "osm_id", "src", "rule", "station"],
    oh,
    schedules: oh.map(compile),
    notes: [""],
    rules: [],
    nodes: [
      [x(0), 35.68, 1 | 2, 1, "A1", "", 1, "ekitan", "", "テスト"],
      [x(1), 35.68, 0, -1, "", "", 2, "", "", ""],
      [x(2), 35.68, 0, -1, "", "", 3, "", "", ""],
      [x(3), 35.68, 1, -1, "", "", 4, "", "", ""],
      [x(4), 35.68, 0, -1, "", "", 5, "", "", ""],
      [x(9), 35.68, 1 | 2 | 8, -1, "B2", "", 6, "", "", "テスト"],
    ],
    edges: [edge(0, 1, 100, 0), edge(1, 2, 100, 2), edge(2, 3, 50, 0, "steps"), edge(1, 3, 400, 3), edge(3, 4, 30, 0)],
  };
}

test("daytime: everything open and reachable", () => {
  const net = new Network(sample());
  const r = net.evaluate(new Date(2026, 8, 30, 12, 0));
  assert.deepEqual([...net.edgeState], [2, 2, 2, 2, 2]);
  assert.equal(r.totalLen, 680);
  assert.equal(r.reachLen, 680);
});

test("night: gated entrance closes, station passage closes", () => {
  const net = new Network(sample());
  net.evaluate(new Date(2026, 8, 30, 2, 0));
  assert.equal(net.nodeOpen[0], 0);
  assert.deepEqual([...net.edgeState], [0, 0, 2, 0, 2]);
  assert.equal(net.entranceUsable(0), false);
});

test("isolated component is marked when surface access is closed", () => {
  const data = sample();
  data.nodes[3][2] = 0;
  const net = new Network(data);
  net.evaluate(new Date(2026, 8, 30, 23, 30));
  assert.equal(net.edgeState[1], 1);
  assert.equal(net.edgeState[2], 1);
  assert.equal(net.edgeState[4], 1);
});

test("public holidays follow PH rules", () => {
  const net = new Network(sample());
  const holiday = new Date(2026, 10, 3, 12, 0);
  assert.equal(net.isHoliday(holiday), true);
  net.evaluate(holiday);
  assert.equal(net.edgeState[3], 0);
  net.evaluate(new Date(2026, 10, 4, 12, 0));
  assert.equal(net.edgeState[3], 2);
});

test("routing prefers shortest open path and honours step-free option", () => {
  const net = new Network(sample());
  net.evaluate(new Date(2026, 8, 30, 12, 0));
  assert.equal(net.route(0, 4).length, 280);
  assert.equal(net.route(0, 4, { stepFree: true }).length, 530);
  net.evaluate(new Date(2026, 8, 30, 21, 0));
  assert.equal(net.route(0, 4, { stepFree: true }), null);
});

test("snap respects level and distance", () => {
  const net = new Network(sample());
  const s = net.snap(139.7615, 35.68001, { maxMeters: 10, level: -1 });
  assert.equal(s.edge, 1);
  assert.ok(s.dist < 2);
  assert.equal(net.snap(139.7615, 35.68001, { maxMeters: 10, level: -3 }), null);
  assert.equal(net.snap(139.7615, 35.6812, { maxMeters: 10 }), null);
});

test("plan enters underground at an open entrance and exits near the destination", () => {
  const net = new Network(sample());
  net.evaluate(new Date(2026, 8, 30, 12, 0));
  const p = net.plan([139.7599, 35.6801], [139.7641, 35.6801]);
  assert.ok(p.underground);
  assert.equal(p.underground.entry, 0);
  assert.equal(p.underground.exit, 3);
  assert.ok(p.underground.undergroundMeters >= 250);
});

test("standalone entrances are listed but never used for routing", () => {
  const net = new Network(sample());
  net.evaluate(new Date(2026, 8, 30, 12, 0));
  const near = net.nearestEntrances(139.769, 35.68, 3);
  assert.equal(near[0].index, 5);
  assert.equal(net.adj[5].length, 0);
});
