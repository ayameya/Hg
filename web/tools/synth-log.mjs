import { readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

export function synthesize(route, meters, { seed = 42, hz = 60, stepLen = 0.7, freq = 1.8, bias = 12, compassNoise = 10 } = {}) {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const K = Math.cos((35.68 * Math.PI) / 180);
  const samples = [];
  let t = 0;
  const push = (v, yawRate, compass) => {
    samples.push([Math.round(t), 0.06 * gauss(), 0.06 * gauss(), 9.80665 + v + 0.08 * gauss(), -yawRate, 0.5 * gauss(), 0.5 * gauss(), compass]);
    t += 1000 / hz;
  };
  for (let i = 0; i < 3 * hz; i++) push(0, 0, null);
  const brgs = [];
  for (let i = 0; i < route.line.length - 1; i++) {
    const a = route.line[i];
    const b = route.line[i + 1];
    const d = meters(a, b);
    const brg = ((Math.atan2((b[0] - a[0]) * K, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
    const n = Math.max(1, Math.round(d / stepLen));
    for (let k = 0; k < n; k++) brgs.push(brg);
  }
  let heading = brgs[0];
  const phaseStep = hz / freq;
  for (const target of brgs) {
    const diff = ((target - heading + 540) % 360) - 180;
    for (let k = 0; k < phaseStep; k++) {
      heading = (heading + diff / phaseStep + 360) % 360;
      const v = 2.4 * Math.sin((2 * Math.PI * k) / phaseStep) + 0.2 * gauss();
      const compass = k % 6 === 0 ? (heading + bias + compassNoise * gauss() + 360) % 360 : null;
      push(v, (diff / phaseStep) * hz, compass);
    }
  }
  const start = route.line[0];
  return {
    version: 1,
    synthetic: true,
    height: 1.65,
    samples,
    labels: [],
    fixes: [[1000, start[1], start[0], -1, 6, "wifi"]],
    pressure: [],
    events: [],
    truthEnd: route.line[route.line.length - 1],
    routeMeters: route.length,
    steps: brgs.length,
  };
}

if (process.argv[1] && process.argv[1].endsWith("synth-log.mjs")) {
  const [netPath, out, a0, a1, b0, b1] = process.argv.slice(2);
  const o = await build({ entryPoints: [new URL("../src/network.js", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", write: false });
  const { Network, meters } = await import(`data:text/javascript;base64,${Buffer.from(o.outputFiles[0].text).toString("base64")}`);
  const net = new Network(JSON.parse(readFileSync(netPath, "utf-8")));
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
  const route = net.route(near(Number(a0), Number(a1)), near(Number(b0), Number(b1)));
  const log = synthesize(route, meters);
  writeFileSync(out, JSON.stringify(log));
  console.log("route", route.length.toFixed(0), "m, steps", log.steps, "samples", log.samples.length);
}
