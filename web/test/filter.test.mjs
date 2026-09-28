import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../tools/compile-hours.mjs";
import { synthesize } from "../tools/synth-log.mjs";

const here = dirname(fileURLToPath(import.meta.url));
async function load(entry) {
  const out = await build({ entryPoints: [join(here, "..", entry)], bundle: true, format: "esm", platform: "node", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
}
const { Network, meters } = await load("src/network.js");
const { GraphParticleFilter, Barometer } = await load("src/pdr/filter.js");
const { MotionProcessor, HeadingFusion, yawRate } = await load("src/pdr/motion.js");

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const LAT0 = 35.68;
const K = Math.cos((LAT0 * Math.PI) / 180);
const pt = (x, y) => [139.76 + x / (111320 * K), LAT0 + y / 111320];

function syntheticNet() {
  const nodes = [pt(0, 0), pt(100, 0), pt(100, 60), pt(100, -60), pt(160, 0), pt(100, 60), pt(100, 60)];
  const oh = ["24/7"];
  const edge = (a, b, level = -1, hw = "footway", via = null) => [a, b, via || [nodes[a], nodes[b]], meters(nodes[a], nodes[b]), 1, "station", 0, hw, "", level, 0, "default", "low", 0, "", ""];
  return {
    edge_fields: ["a", "b", "coords", "len", "way", "cat", "connector", "highway", "name", "level", "oh", "src", "conf", "note", "rule", "wheelchair"],
    node_fields: ["lon", "lat", "flags", "oh", "ref", "name", "osm_id", "src", "rule", "station"],
    oh,
    schedules: oh.map(compile),
    notes: [""],
    rules: [],
    nodes: nodes.map((c, i) => [c[0], c[1], i === 0 ? 3 : 0, -1, "", "", i, "", "", ""]),
    edges: [edge(0, 1), edge(1, 2), edge(1, 3), edge(1, 4), edge(2, 5, -1, "elevator", [nodes[2], pt(100.5, 60)]), edge(5, 6, -2, "footway", [pt(100.5, 60), pt(100, 110)])],
  };
}

function walk(path, stepLen, headingNoise, bias, r) {
  const steps = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const d = meters(a, b);
    const brg = (Math.atan2((b[0] - a[0]) * K, b[1] - a[1]) * 180) / Math.PI;
    const n = Math.max(1, Math.round(d / stepLen));
    for (let k = 0; k < n; k++) {
      const g = Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
      steps.push({ len: d / n, heading: (brg + bias + headingNoise * g + 360) % 360 });
    }
  }
  return steps;
}

function freeTrack(start, steps, scale) {
  let [lon, lat] = start;
  for (const s of steps) {
    lon += (s.len * scale * Math.sin((s.heading * Math.PI) / 180)) / (111320 * K);
    lat += (s.len * scale * Math.cos((s.heading * Math.PI) / 180)) / 111320;
  }
  return [lon, lat];
}

test("particles follow the correct branch of an L-shaped corridor despite heading bias", () => {
  const net = new Network(syntheticNet());
  net.evaluate(new Date(2026, 8, 30, 12));
  const r = rng(11);
  const f = new GraphParticleFilter(net, { rand: r, n: 300 });
  f.fix(...pt(0, 0), 5, -1);
  const truth = [pt(0, 0), pt(100, 0), pt(100, 55)];
  const steps = walk(truth, 0.7, 8, 12, r);
  for (const s of steps) f.step(s.len * 1.08, s.heading);
  const est = f.estimate();
  const err = meters([est.lon, est.lat], truth[2]);
  const freeErr = meters(freeTrack(truth[0], steps, 1.08), truth[2]);
  assert.ok(err < 10, `filter error ${err.toFixed(1)}m`);
  assert.ok(err < freeErr, `filter ${err.toFixed(1)} vs free ${freeErr.toFixed(1)}`);
  assert.ok(est.lat > LAT0 + 30 / 111320, "estimate should be on the north branch");
});

test("a detected level change moves particles to the other level", () => {
  const net = new Network(syntheticNet());
  net.evaluate(new Date(2026, 8, 30, 12));
  const f = new GraphParticleFilter(net, { rand: rng(3), n: 200 });
  f.fix(...pt(100, 58), 4, -1);
  assert.equal(f.estimate().level, -1);
  f.levelChange(-3.8);
  assert.equal(f.estimate().level, -2);
});

test("barometer reports a floor change after the pressure settles", () => {
  const b = new Barometer();
  const ev = [];
  b.on((e) => ev.push(e));
  let t = 0;
  for (let i = 0; i < 50; i++) b.push((t += 200), 1010.0);
  for (let i = 0; i < 40; i++) b.push((t += 200), 1010.0 + (0.45 * i) / 40);
  for (let i = 0; i < 60; i++) b.push((t += 200), 1010.45);
  assert.equal(ev.length, 1);
  assert.ok(ev[0].dz < -3 && ev[0].dz > -5, `${ev[0].dz}`);
});

const NET = join(here, "..", "..", "docs", "data", "network.json");
test("tracks a real 800 m underground route in Otemachi with biased heading and step length", { skip: !existsSync(NET) }, () => {
  const net = new Network(JSON.parse(readFileSync(NET, "utf-8")));
  net.evaluate(new Date(2026, 8, 30, 12));
  const near = (lon, lat) => {
    let best = -1;
    let bd = Infinity;
    net.nodes.forEach((n, i) => {
      if (!net.adj[i].some((e) => net.edgeState[e] === 2)) return;
      const d = meters([lon, lat], [n[0], n[1]]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };
  const route = net.route(near(139.7648, 35.6868), near(139.7662, 35.6818));
  assert.ok(route && route.length > 300, `route ${route && route.length}`);
  const means = [];
  const frees = [];
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = rng(seed);
    const f = new GraphParticleFilter(net, { rand: r, n: 300 });
    f.fix(route.line[0][0], route.line[0][1], 8, -1);
    const steps = walk(route.line, 0.7, 15, 15, r);
    let travelled = 0;
    let sum = 0;
    for (const s of steps) {
      f.step(s.len * 0.88, s.heading);
      travelled += s.len;
      const est = f.estimate();
      sum += meters([est.lon, est.lat], pointAlong(route.line, travelled));
    }
    means.push(sum / steps.length);
    frees.push(meters(freeTrack(route.line[0], steps, 0.88), route.line[route.line.length - 1]));
  }
  means.sort((x, y) => x - y);
  frees.sort((x, y) => x - y);
  console.log(`route ${route.length.toFixed(0)}m, mean error along route ${means.map((e) => e.toFixed(1)).join(",")} m, free PDR end error median ${frees[2].toFixed(1)} m`);
  assert.ok(means[2] < 5, `median of mean errors ${means[2].toFixed(1)}m`);
});

function pointAlong(line, dist) {
  let left = dist;
  for (let i = 0; i < line.length - 1; i++) {
    const d = meters(line[i], line[i + 1]);
    if (left <= d) {
      const t = d ? left / d : 0;
      return [line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t];
    }
    left -= d;
  }
  return line[line.length - 1];
}

test("end to end: raw accelerometer, gyro and biased compass samples track a real route", { skip: !existsSync(NET) }, () => {
  const net = new Network(JSON.parse(readFileSync(NET, "utf-8")));
  net.evaluate(new Date(2026, 8, 30, 12));
  let best = [-1, Infinity];
  let bestB = [-1, Infinity];
  net.nodes.forEach((n, i) => {
    if (!net.adj[i].some((e) => net.edgeState[e] === 2)) return;
    const da = meters([139.7648, 35.6868], [n[0], n[1]]);
    const db = meters([139.7662, 35.6818], [n[0], n[1]]);
    if (da < best[1]) best = [i, da];
    if (db < bestB[1]) bestB = [i, db];
  });
  const route = net.route(best[0], bestB[0]);
  const log = synthesize(route, meters, { bias: 12, compassNoise: 10 });
  const mp = new MotionProcessor();
  const hf = new HeadingFusion();
  const f = new GraphParticleFilter(net, { rand: rng(9), n: 300 });
  const fix = log.fixes[0];
  let steps = 0;
  mp.on((e) => {
    if (e.type !== "step") return;
    steps++;
    f.step(e.length, hf.heading);
  });
  let prev = null;
  let fixed = false;
  for (const s of log.samples) {
    if (!fixed && s[0] >= fix[0]) {
      f.fix(fix[2], fix[1], fix[4], fix[3]);
      fixed = true;
    }
    if (s[7] != null) hf.compass(s[7]);
    mp.push(s[0], s[1], s[2], s[3]);
    if (prev != null) hf.gyro((s[0] - prev) / 1000, yawRate(mp.grav, { alpha: s[4], beta: s[5], gamma: s[6] }));
    prev = s[0];
  }
  const est = f.estimate();
  const err = meters([est.lon, est.lat], log.truthEnd);
  console.log(`end to end: ${steps}/${log.steps} steps, end error ${err.toFixed(1)} m, step scale ${est.stepScale.toFixed(2)}, heading bias ${est.headingBias.toFixed(0)}°`);
  assert.ok(Math.abs(steps - log.steps) <= 5);
  assert.ok(err < 10, `end error ${err.toFixed(1)}m`);
});
