import { LINE_STRIDE } from "./tess.js";

const FILL_VS = `
attribute vec2 a_pos;
uniform vec4 u_tf;
void main() {
  gl_Position = vec4(a_pos * u_tf.xy + u_tf.zw, 0.0, 1.0);
}`;

const FILL_FS = `
precision mediump float;
uniform vec4 u_color;
void main() {
  gl_FragColor = u_color;
}`;

const LINE_VS = `
attribute vec2 a_pos;
attribute vec2 a_ext;
attribute float a_side;
attribute float a_dist;
uniform vec4 u_tf;
uniform float u_half;
uniform float u_ppu;
varying float v_side;
varying float v_dist;
void main() {
  vec2 p = a_pos + a_ext * u_half;
  v_side = a_side * u_half * u_ppu;
  v_dist = a_dist * u_ppu;
  gl_Position = vec4(p * u_tf.xy + u_tf.zw, 0.0, 1.0);
}`;

const LINE_FS = `
precision mediump float;
uniform vec4 u_color;
uniform float u_halfpx;
uniform vec2 u_dash;
varying float v_side;
varying float v_dist;
void main() {
  if (u_dash.x > 0.0 && mod(v_dist, u_dash.x + u_dash.y) > u_dash.x) discard;
  float a = clamp(u_halfpx - abs(v_side) + 0.5, 0.0, 1.0);
  gl_FragColor = u_color * a;
}`;

const colorCache = new Map();
export function parseColor(c) {
  let v = colorCache.get(c);
  if (v) return v;
  const h = c.replace("#", "");
  const n = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  v = [parseInt(n.slice(0, 2), 16) / 255, parseInt(n.slice(2, 4), 16) / 255, parseInt(n.slice(4, 6), 16) / 255, n.length >= 8 ? parseInt(n.slice(6, 8), 16) / 255 : 1];
  colorCache.set(c, v);
  return v;
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function program(gl, vs, fs, attribs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u, attribs: attribs.length };
}

export class Renderer {
  constructor(canvas) {
    const opts = { antialias: true, alpha: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: "high-performance" };
    let gl = canvas.getContext("webgl2", opts);
    this.webgl2 = !!gl;
    if (!gl) gl = canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts);
    if (!gl) throw new Error("WebGL is not available");
    if (!this.webgl2 && !gl.getExtension("OES_element_index_uint")) throw new Error("OES_element_index_uint is not available");
    this.gl = gl;
    this.canvas = canvas;
    this.fill = program(gl, FILL_VS, FILL_FS, ["a_pos"]);
    this.line = program(gl, LINE_VS, LINE_FS, ["a_pos", "a_ext", "a_side", "a_dist"]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.current = null;
    this.stats = { draws: 0, triangles: 0 };
  }

  resize(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  begin(bg) {
    const gl = this.gl;
    const c = parseColor(bg);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(c[0], c[1], c[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.stats.draws = 0;
    this.stats.triangles = 0;
    this.current = null;
  }

  upload(data) {
    const gl = this.gl;
    const g = { ranges: {}, bytes: 0 };
    const buf = (target, arr) => {
      const b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, arr, gl.STATIC_DRAW);
      g.bytes += arr.byteLength;
      return b;
    };
    if (data.fill && data.fill.idx.length) {
      g.fillPos = buf(gl.ARRAY_BUFFER, data.fill.pos);
      g.fillIdx = buf(gl.ELEMENT_ARRAY_BUFFER, data.fill.idx);
      if (data.fill.outline.length) g.outlineIdx = buf(gl.ELEMENT_ARRAY_BUFFER, data.fill.outline);
      for (const r of data.fill.ranges) (g.ranges[r.layer] ||= []).push({ ...r, kind: "fill" });
    }
    if (data.line && data.line.idx.length) {
      g.lineV = buf(gl.ARRAY_BUFFER, data.line.v);
      g.lineIdx = buf(gl.ELEMENT_ARRAY_BUFFER, data.line.idx);
      for (const r of data.line.ranges) (g.ranges[r.layer] ||= []).push({ ...r, kind: "line" });
    }
    return g;
  }

  release(g) {
    if (!g) return;
    const gl = this.gl;
    for (const k of ["fillPos", "fillIdx", "outlineIdx", "lineV", "lineIdx"]) if (g[k]) gl.deleteBuffer(g[k]);
  }

  scissor(rect) {
    const gl = this.gl;
    if (!rect) {
      gl.disable(gl.SCISSOR_TEST);
      return;
    }
    const d = this.dpr;
    const x0 = Math.max(0, Math.floor(rect[0] * d));
    const y0 = Math.max(0, Math.floor(rect[1] * d));
    const x1 = Math.min(this.canvas.width, Math.ceil(rect[2] * d));
    const y1 = Math.min(this.canvas.height, Math.ceil(rect[3] * d));
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x0, this.canvas.height - y1, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
  }

  tf(s, ox, oy) {
    return [(2 * s) / this.w, (-2 * s) / this.h, (2 * ox) / this.w - 1, 1 - (2 * oy) / this.h];
  }

  use(prog) {
    const gl = this.gl;
    if (this.current === prog) return;
    gl.useProgram(prog.p);
    for (let i = 0; i < 4; i++) {
      if (i < prog.attribs) gl.enableVertexAttribArray(i);
      else gl.disableVertexAttribArray(i);
    }
    this.current = prog;
    this.boundV = null;
  }

  color(prog, color, opacity = 1) {
    const c = parseColor(color);
    const a = c[3] * opacity;
    this.gl.uniform4f(prog.u.u_color, c[0] * a, c[1] * a, c[2] * a, a);
  }

  drawFill(g, r, tf, color, opacity) {
    if (!r.count) return;
    const gl = this.gl;
    const P = this.fill;
    this.use(P);
    if (this.boundV !== g.fillPos) {
      gl.bindBuffer(gl.ARRAY_BUFFER, g.fillPos);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      this.boundV = g.fillPos;
    }
    gl.uniform4f(P.u.u_tf, tf[0], tf[1], tf[2], tf[3]);
    this.color(P, color, opacity);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.fillIdx);
    gl.drawElements(gl.TRIANGLES, r.count, gl.UNSIGNED_INT, r.start * 4);
    this.stats.draws++;
    this.stats.triangles += r.count / 3;
  }

  drawOutline(g, r, tf, color, opacity) {
    if (!r.ocount || !g.outlineIdx) return;
    const gl = this.gl;
    const P = this.fill;
    this.use(P);
    if (this.boundV !== g.fillPos) {
      gl.bindBuffer(gl.ARRAY_BUFFER, g.fillPos);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      this.boundV = g.fillPos;
    }
    gl.uniform4f(P.u.u_tf, tf[0], tf[1], tf[2], tf[3]);
    this.color(P, color, opacity);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.outlineIdx);
    gl.drawElements(gl.LINES, r.ocount, gl.UNSIGNED_INT, r.ostart * 4);
    this.stats.draws++;
  }

  drawLine(g, r, tf, ppuCss, paint) {
    if (!r.count) return;
    const gl = this.gl;
    const P = this.line;
    this.use(P);
    const S = LINE_STRIDE * 4;
    if (this.boundV !== g.lineV) {
      gl.bindBuffer(gl.ARRAY_BUFFER, g.lineV);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, S, 0);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, S, 8);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, S, 16);
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, S, 20);
      this.boundV = g.lineV;
    }
    const d = this.dpr;
    const ppu = ppuCss * d;
    const widthPx = Math.max(paint.width, 0.1) * d;
    const halfPx = Math.max(widthPx, 1) / 2;
    const fade = Math.min(1, widthPx);
    gl.uniform4f(P.u.u_tf, tf[0], tf[1], tf[2], tf[3]);
    gl.uniform1f(P.u.u_half, (halfPx + 1) / ppu);
    gl.uniform1f(P.u.u_ppu, ppu);
    gl.uniform1f(P.u.u_halfpx, halfPx);
    if (paint.dash) gl.uniform2f(P.u.u_dash, paint.dash[0] * d, paint.dash[1] * d);
    else gl.uniform2f(P.u.u_dash, 0, 0);
    this.color(P, paint.color, (paint.opacity ?? 1) * fade);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.lineIdx);
    gl.drawElements(gl.TRIANGLES, r.count, gl.UNSIGNED_INT, r.start * 4);
    this.stats.draws++;
    this.stats.triangles += r.count / 3;
  }
}
