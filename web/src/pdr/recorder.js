import { MotionProcessor, trainModel } from "./motion.js";

export const LABELS = {
  walk: "平地",
  up: "上り階段",
  down: "下り階段",
  elevator: "エレベーター",
  escalator: "エスカレーター",
  still: "停止",
};

const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

export class Recorder {
  constructor(meta = {}) {
    this.log = {
      version: 1,
      started: new Date().toISOString(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      ...meta,
      samples: [],
      labels: [],
      fixes: [],
      pressure: [],
      events: [],
    };
  }

  sample(t, ax, ay, az, alpha, beta, gamma, compass) {
    this.log.samples.push([Math.round(t), r3(ax), r3(ay), r3(az), r3(alpha), r3(beta), r3(gamma), compass == null ? null : Math.round(compass * 10) / 10]);
  }

  label(t, name) {
    this.log.labels.push([Math.round(t), name]);
  }

  fix(t, p) {
    this.log.fixes.push([Math.round(t), p.lat, p.lon, p.level ?? null, p.accuracy ?? null, p.source || ""]);
  }

  pressure(t, hPa) {
    this.log.pressure.push([Math.round(t), hPa]);
  }

  event(t, e) {
    this.log.events.push([Math.round(t), e]);
  }

  get duration() {
    const s = this.log.samples;
    return s.length ? (s[s.length - 1][0] - s[0][0]) / 1000 : 0;
  }
}

export function labelAt(labels, t) {
  let cur = null;
  for (const [lt, name] of labels) {
    if (lt > t) break;
    cur = name;
  }
  return cur;
}

export function stepsFromLog(log, height) {
  const mp = new MotionProcessor({ height });
  const out = [];
  mp.on((e) => {
    if (e.type === "step") out.push({ t: e.t, features: e.features, label: labelAt(log.labels, e.t), length: e.length });
  });
  for (const s of log.samples) mp.push(s[0], s[1], s[2], s[3]);
  return out;
}

export function trainFromLogs(logs, height) {
  const steps = logs.flatMap((l) => stepsFromLog(l, height));
  return trainModel(steps.filter((s) => s.label));
}

export function mergeEvents(log) {
  const ev = [];
  for (const s of log.samples) ev.push([s[0], "m", s]);
  for (const f of log.fixes || []) ev.push([f[0], "f", f]);
  for (const p of log.pressure || []) ev.push([p[0], "p", p]);
  ev.sort((a, b) => a[0] - b[0]);
  return ev;
}
