import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = await build({ entryPoints: [join(here, "..", "src", "pdr", "motion.js")], bundle: true, format: "esm", platform: "node", write: false });
const { MotionProcessor, HeadingFusion, trainModel, yawRate } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function gauss(r) {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

function feed(mp, seconds, fn, hz = 60, t0 = 0) {
  const r = rng(7);
  for (let i = 0; i < seconds * hz; i++) {
    const t = t0 + (i * 1000) / hz;
    const [v, h] = fn(t / 1000, r);
    mp.push(t, 0.3 * h + 0.05 * gauss(r), 0.2 * h + 0.05 * gauss(r), 9.80665 + v + 0.05 * gauss(r));
  }
  return t0 + seconds * 1000;
}

function walking(freq, amp, asym = 1) {
  return (t, r) => {
    const s = Math.sin(2 * Math.PI * freq * t);
    const v = s > 0 ? amp * s * asym : amp * s;
    return [v + 0.15 * gauss(r), 1.2 * Math.sin(2 * Math.PI * freq * t + 1) + 0.1 * gauss(r)];
  };
}

test("counts steps while walking at 1.8 Hz", () => {
  const mp = new MotionProcessor();
  const steps = [];
  mp.on((e) => e.type === "step" && steps.push(e));
  feed(mp, 20, walking(1.8, 2.4));
  assert.ok(Math.abs(steps.length - 36) <= 2, `steps ${steps.length}`);
  const mean = steps.reduce((s, e) => s + e.length, 0) / steps.length;
  assert.ok(mean > 0.5 && mean < 0.9, `step length ${mean}`);
});

test("no steps while standing still", () => {
  const mp = new MotionProcessor();
  const steps = [];
  mp.on((e) => e.type === "step" && steps.push(e));
  feed(mp, 20, (t, r) => [0.08 * gauss(r), 0.05 * gauss(r)]);
  assert.equal(steps.length, 0);
});

test("detects an upward elevator ride and its height", () => {
  const mp = new MotionProcessor();
  const ev = [];
  mp.on((e) => e.type === "elevator" && ev.push(e));
  const profile = (t) => (t > 3 && t < 4.5 ? 0.9 : t > 10.5 && t < 12 ? -0.9 : 0);
  feed(mp, 18, (t, r) => [profile(t) + 0.04 * gauss(r), 0.03 * gauss(r)]);
  assert.equal(ev.length, 1);
  const expected = 0.9 * 1.5 * (1.5 / 2 + 6 + 1.5 / 2);
  assert.ok(ev[0].dz > 0 && Math.abs(ev[0].dz - expected) / expected < 0.35, `dz ${ev[0].dz} vs ${expected}`);
});

test("detects a downward elevator ride", () => {
  const mp = new MotionProcessor();
  const ev = [];
  mp.on((e) => e.type === "elevator" && ev.push(e));
  const profile = (t) => (t > 3 && t < 4.5 ? -0.9 : t > 8 && t < 9.5 ? 0.9 : 0);
  feed(mp, 15, (t, r) => [profile(t) + 0.04 * gauss(r), 0.03 * gauss(r)]);
  assert.equal(ev.length, 1);
  assert.ok(ev[0].dz < -3, `dz ${ev[0].dz}`);
});

test("trained model separates stair gaits from level walking", () => {
  const labeled = [];
  const collect = (label, fn, seconds) => {
    const mp = new MotionProcessor();
    mp.on((e) => e.type === "step" && labeled.push({ label, features: e.features }));
    feed(mp, seconds, fn);
  };
  collect("walk", walking(1.85, 2.2), 30);
  collect("up", walking(1.45, 1.6, 0.8), 30);
  collect("down", walking(2.1, 3.4, 1.5), 30);
  const model = trainModel(labeled);
  assert.equal(model.trained, true);
  const check = (fn, want) => {
    const mp = new MotionProcessor({ model });
    const seen = [];
    mp.on((e) => e.type === "step" && seen.push(e.activity));
    feed(mp, 12, fn);
    const tail = seen.slice(4);
    const hit = tail.filter((a) => a === want).length / tail.length;
    assert.ok(hit > 0.7, `${want}: ${hit.toFixed(2)} ${tail.join(",")}`);
  };
  check(walking(1.85, 2.2), "walk");
  check(walking(1.45, 1.6, 0.8), "up");
  check(walking(2.1, 3.4, 1.5), "down");
});

test("heading fusion integrates gyro and slowly follows the compass", () => {
  const h = new HeadingFusion();
  h.compass(90);
  for (let i = 0; i < 60; i++) h.gyro(1 / 60, -90);
  assert.ok(Math.abs(h.heading - 180) < 1, `${h.heading}`);
  for (let i = 0; i < 10; i++) h.compass(100);
  assert.ok(h.heading > 100 && h.heading < 180);
  assert.equal(Math.round(yawRate([0, 0, 9.8], { alpha: 30, beta: 0, gamma: 0 })), 30);
  assert.equal(Math.round(yawRate([0, 9.8, 0], { alpha: 0, beta: 0, gamma: 20 })), 20);
});
