export const ACTIVITIES = {
  walk: "平地を歩行",
  up: "階段を上る",
  down: "階段を下る",
  still: "停止",
};

const DEFAULT_MODEL = {
  features: ["freq", "p2p", "vh", "asym"],
  scale: [0.35, 1.6, 0.6, 0.35],
  centroids: {
    walk: [1.85, 4.2, 1.5, 1.0],
    up: [1.55, 3.4, 2.3, 0.8],
    down: [2.05, 6.2, 2.1, 1.45],
  },
  trained: false,
};

const G = 9.80665;

export class MotionProcessor {
  constructor(opts = {}) {
    this.height = opts.height || 1.65;
    this.model = opts.model || DEFAULT_MODEL;
    this.listeners = new Set();
    this.reset();
  }

  reset() {
    this.last = null;
    this.g0 = null;
    this.grav = null;
    this.m = 0;
    this.mSlow = 0;
    this.rms = 1;
    this.peak = null;
    this.valley = null;
    this.armed = false;
    this.lastStep = null;
    this.stepBuf = [];
    this.hSum = 0;
    this.vSum = 0;
    this.nSum = 0;
    this.steps = 0;
    this.activity = "still";
    this.confidence = 0;
    this.ride = null;
    this.vz = 0;
    this.age = 0;
    this.cooldown = 0;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(ev) {
    for (const fn of this.listeners) fn(ev);
  }

  setModel(model) {
    this.model = model || DEFAULT_MODEL;
  }

  stepLength(p2p) {
    const k = (0.3 * this.height) / 1.0;
    return Math.max(0.3, Math.min(1.1, k * Math.max(p2p, 0.5) ** 0.25));
  }

  push(t, ax, ay, az) {
    const mag = Math.hypot(ax, ay, az);
    if (!Number.isFinite(mag) || mag < 1) return;
    if (this.last == null) {
      this.last = t;
      this.g0 = mag > 5 && mag < 15 ? mag : G;
      this.grav = [ax, ay, az];
      return;
    }
    const dt = Math.min(0.1, Math.max(0.001, (t - this.last) / 1000));
    this.last = t;
    const kg = 1 - Math.exp(-dt / 0.8);
    for (let i = 0; i < 3; i++) this.grav[i] += kg * ([ax, ay, az][i] - this.grav[i]);
    const gn = Math.hypot(...this.grav) || 1;
    const gh = this.grav.map((v) => v / gn);
    const lin = [ax - this.grav[0], ay - this.grav[1], az - this.grav[2]];
    const vComp = lin[0] * gh[0] + lin[1] * gh[1] + lin[2] * gh[2];
    const hComp = Math.hypot(lin[0] - vComp * gh[0], lin[1] - vComp * gh[1], lin[2] - vComp * gh[2]);

    const raw = mag - this.g0;
    this.m += (1 - Math.exp(-dt / 0.06)) * (raw - this.m);
    this.mSlow += (1 - Math.exp(-dt / 0.4)) * (raw - this.mSlow);
    this.rms = Math.sqrt(this.rms * this.rms + (1 - Math.exp(-dt / 2)) * (this.m * this.m - this.rms * this.rms));
    this.vSum += vComp * vComp;
    this.hSum += hComp * hComp;
    this.nSum += 1;

    const moving = this.lastStep != null && t - this.lastStep < 1500;
    this.age = (this.age || 0) + dt;
    const tauG = this.age < 2 ? 0.4 : 4;
    const accelerating = !moving && Math.abs(this.mSlow) > 0.12;
    if (!this.ride && !accelerating) this.g0 += (1 - Math.exp(-dt / tauG)) * (mag - this.g0);

    this.detectStep(t);
    this.detectElevator(t, dt, moving);
    if (!moving && this.activity !== "still" && (!this.lastStep || t - this.lastStep > 2000)) {
      this.activity = "still";
      this.confidence = 1;
      this.stepBuf = [];
      this.emit({ type: "activity", t, activity: "still", confidence: 1 });
    }
  }

  detectStep(t) {
    const thr = Math.max(0.9, 0.55 * this.rms);
    const m = this.m;
    if (m > thr) {
      if (!this.peak || m > this.peak.v) this.peak = { v: m, t };
      this.armed = true;
    }
    if (this.armed && m < -0.45 * thr) {
      if (!this.valley || m < this.valley.v) this.valley = { v: m, t };
    }
    if (this.armed && this.valley && m > this.valley.v + 0.3 && this.peak) {
      const pt = this.peak.t;
      const minGap = 260;
      if (this.lastStep == null || pt - this.lastStep >= minGap) this.registerStep(pt, this.peak.v, this.valley.v);
      this.peak = null;
      this.valley = null;
      this.armed = false;
    }
    if (this.peak && t - this.peak.t > 1200) {
      this.peak = null;
      this.valley = null;
      this.armed = false;
    }
  }

  registerStep(t, vmax, vmin) {
    const duration = this.lastStep == null ? 550 : Math.min(2000, t - this.lastStep);
    this.lastStep = t;
    this.steps += 1;
    const p2p = vmax - vmin;
    const vh = this.hSum > 0 ? Math.sqrt(this.vSum / Math.max(this.hSum, 1e-6)) : 1;
    const f = { freq: 1000 / duration, p2p, vh, asym: vmax / Math.max(0.2, -vmin) };
    this.vSum = 0;
    this.hSum = 0;
    this.nSum = 0;
    this.stepBuf.push(f);
    if (this.stepBuf.length > 4) this.stepBuf.shift();
    const cls = this.classify(this.stepBuf);
    this.activity = cls.activity;
    this.confidence = cls.confidence;
    const stairs = (cls.activity === "up" || cls.activity === "down") && cls.confidence > 0.5;
    const length = this.stepLength(p2p) * (stairs ? 0.75 : 1);
    this.emit({ type: "step", t, length, features: f, activity: cls.activity, confidence: cls.confidence, probs: cls.probs });
  }

  classify(buf) {
    if (buf.length < 2) return { activity: "walk", confidence: 0.3, probs: { walk: 1 } };
    const names = this.model.features;
    const mean = names.map((n) => buf.reduce((s, f) => s + f[n], 0) / buf.length);
    const scores = {};
    let total = 0;
    let minD2 = Infinity;
    for (const [label, c] of Object.entries(this.model.centroids)) {
      let d2 = 0;
      c.forEach((v, i) => {
        d2 += ((mean[i] - v) / this.model.scale[i]) ** 2;
      });
      minD2 = Math.min(minD2, d2);
      scores[label] = Math.exp(-d2 / 2);
      total += scores[label];
    }
    if (minD2 > 16 || !(total > 0)) return { activity: "walk", confidence: 0, probs: { walk: 1 }, novel: true };
    let best = "walk";
    for (const k of Object.keys(scores)) {
      scores[k] = total > 0 ? scores[k] / total : 0;
      if (scores[k] > (scores[best] ?? 0)) best = k;
    }
    const conf = this.model.trained ? scores[best] ?? 0 : 0;
    return { activity: best, confidence: conf, probs: scores };
  }

  detectElevator(t, dt, moving) {
    if (moving) {
      this.vz = 0;
      this.ride = null;
      return;
    }
    const a = Math.abs(this.mSlow) > 0.06 ? this.m : 0;
    this.vz = this.vz * Math.exp(-dt / 120) + a * dt;
    if (!this.ride) {
      if (this.cooldown && t < this.cooldown) {
        this.vz = 0;
        return;
      }
      if (Math.abs(this.vz) > 0.35) this.ride = { start: t, dz: 0, peakV: 0, braking: false };
      else return;
    }
    const r = this.ride;
    r.dz += this.vz * dt;
    r.peakV = Math.max(r.peakV, Math.abs(this.vz));
    if (Math.sign(this.mSlow) !== Math.sign(r.dz) && Math.abs(this.mSlow) > 0.2) r.braking = true;
    const settled = Math.abs(this.mSlow) < 0.08 && (Math.abs(this.vz) < 0.2 || r.braking);
    if (settled && r.braking && t - r.start > 2500) {
      if (Math.abs(r.dz) > 2) this.emit({ type: "elevator", t, dz: r.dz, duration: (t - r.start) / 1000 });
      this.ride = null;
      this.vz = 0;
      this.cooldown = t + 3000;
    } else if (t - r.start > 90000) {
      this.ride = null;
      this.vz = 0;
    }
  }
}

export function yawRate(grav, rotationRate) {
  const gn = Math.hypot(...grav) || 1;
  const { alpha = 0, beta = 0, gamma = 0 } = rotationRate || {};
  return (beta * grav[0] + gamma * grav[1] + alpha * grav[2]) / gn;
}

export class HeadingFusion {
  constructor() {
    this.heading = null;
    this.lastCompass = null;
  }

  gyro(dt, rateDegPerSec) {
    if (this.heading == null || !Number.isFinite(rateDegPerSec)) return;
    this.heading = (this.heading - rateDegPerSec * dt + 720) % 360;
  }

  compass(h) {
    if (!Number.isFinite(h)) return;
    if (this.heading == null) {
      this.heading = h;
      return;
    }
    const diff = ((h - this.heading + 540) % 360) - 180;
    const k = Math.abs(diff) > 45 ? 0.004 : 0.02;
    this.heading = (this.heading + k * diff + 360) % 360;
    this.lastCompass = h;
  }

  set(h) {
    this.heading = ((h % 360) + 360) % 360;
  }
}

export function trainModel(labeledSteps) {
  const names = DEFAULT_MODEL.features;
  const by = {};
  for (const { label, features } of labeledSteps) {
    if (!["walk", "up", "down"].includes(label)) continue;
    (by[label] ||= []).push(names.map((n) => features[n]));
  }
  const centroids = { ...DEFAULT_MODEL.centroids };
  const counts = {};
  const all = [];
  for (const [label, rows] of Object.entries(by)) {
    if (rows.length < 8) continue;
    counts[label] = rows.length;
    centroids[label] = names.map((_, i) => rows.reduce((s, r) => s + r[i], 0) / rows.length);
    all.push(...rows.map((r) => r.map((v, i) => v - centroids[label][i])));
  }
  const scale = names.map((_, i) => {
    if (all.length < 10) return DEFAULT_MODEL.scale[i];
    const s = Math.sqrt(all.reduce((acc, r) => acc + r[i] * r[i], 0) / all.length);
    return Math.max(s, DEFAULT_MODEL.scale[i] * 0.3);
  });
  return { features: names, scale, centroids, trained: Object.keys(counts).length >= 2, counts };
}

export { DEFAULT_MODEL };
