import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bundled = await build({
  entryPoints: [join(here, "..", "src", "network.js")],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const { Network } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function sample() {
  const edge = (a, b, len, oh, highway = "footway") => [a, b, [[139.76 + a * 0.001, 35.68], [139.76 + b * 0.001, 35.68]], len, 1, "station", 0, highway, "", -1, oh, "default", "low", 0, "", ""];
  return {
    edge_fields: ["a", "b", "coords", "len", "way", "cat", "connector", "highway", "name", "level", "oh", "src", "conf", "note", "rule", "wheelchair"],
    node_fields: ["lon", "lat", "flags", "oh", "ref", "name", "osm_id", "src", "rule"],
    oh: ["24/7", "07:00-23:00", "05:00-01:00", "Mo-Fr 08:00-20:00; PH off"],
    notes: [""],
    rules: [],
    nodes: [
      [139.76, 35.68, 1 | 2, 1, "A1", "", 1, "override", ""],
      [139.761, 35.68, 0, -1, "", "", 2, "", ""],
      [139.762, 35.68, 0, -1, "", "", 3, "", ""],
      [139.763, 35.68, 1, -1, "", "", 4, "", ""],
      [139.764, 35.68, 0, -1, "", "", 5, "", ""],
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
  assert.equal(net.edgeState[0], 0);
  assert.equal(net.edgeState[1], 0);
  assert.equal(net.edgeState[3], 0);
  assert.equal(net.edgeState[2], 2);
  assert.equal(net.edgeState[4], 2);
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

test("ignoreTime opens everything", () => {
  const net = new Network(sample());
  net.evaluate(new Date(2026, 8, 30, 3, 0), true);
  assert.deepEqual([...net.edgeState], [2, 2, 2, 2, 2]);
});

test("routing prefers shortest open path and honours step-free option", () => {
  const net = new Network(sample());
  net.evaluate(new Date(2026, 8, 30, 12, 0));
  const r = net.route(0, 4);
  assert.equal(r.length, 100 + 100 + 50 + 30);
  const sf = net.route(0, 4, { stepFree: true });
  assert.equal(sf.length, 100 + 400 + 30);
  net.evaluate(new Date(2026, 8, 30, 21, 0));
  const evening = net.route(0, 4, { stepFree: true });
  assert.equal(evening, null);
});
