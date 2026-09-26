const td = new TextDecoder();

class Reader {
  constructor(buf, start = 0, end = buf.length) {
    this.buf = buf;
    this.pos = start;
    this.end = end;
  }

  varint() {
    let result = 0;
    let shift = 1;
    for (;;) {
      const b = this.buf[this.pos++];
      result += (b & 0x7f) * shift;
      if (b < 0x80) return result;
      shift *= 128;
    }
  }

  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
  }

  sub() {
    const len = this.varint();
    const r = new Reader(this.buf, this.pos, this.pos + len);
    this.pos += len;
    return r;
  }

  string() {
    const len = this.varint();
    const s = td.decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }

  packed() {
    const r = this.sub();
    const out = [];
    while (r.pos < r.end) out.push(r.varint());
    return out;
  }
}

function readValue(r) {
  let v = null;
  const dv = new DataView(r.buf.buffer, r.buf.byteOffset);
  while (r.pos < r.end) {
    const tag = r.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 1) v = r.string();
    else if (field === 2) {
      v = dv.getFloat32(r.pos, true);
      r.pos += 4;
    } else if (field === 3) {
      v = dv.getFloat64(r.pos, true);
      r.pos += 8;
    } else if (field === 4 || field === 5) v = r.varint();
    else if (field === 6) {
      const n = r.varint();
      v = n % 2 ? -(n + 1) / 2 : n / 2;
    } else if (field === 7) v = r.varint() === 1;
    else r.skip(wire);
  }
  return v;
}

function decodeGeometry(cmds) {
  const parts = [];
  let cur = null;
  let x = 0;
  let y = 0;
  let i = 0;
  while (i < cmds.length) {
    const c = cmds[i++];
    const id = c & 7;
    const count = c >> 3;
    if (id === 1 || id === 2) {
      for (let k = 0; k < count; k++) {
        const dx = cmds[i++];
        const dy = cmds[i++];
        x += (dx >> 1) ^ -(dx & 1);
        y += (dy >> 1) ^ -(dy & 1);
        if (id === 1) {
          cur = [x, y];
          parts.push(cur);
        } else cur.push(x, y);
      }
    } else if (id === 7 && cur) {
      cur.closed = true;
    }
  }
  return parts;
}

export function decodeTile(buf) {
  const layers = {};
  const r = new Reader(buf);
  while (r.pos < r.end) {
    const tag = r.varint();
    if (tag >> 3 !== 3) {
      r.skip(tag & 7);
      continue;
    }
    const lr = r.sub();
    let name = "";
    let extent = 4096;
    const keys = [];
    const values = [];
    const raw = [];
    while (lr.pos < lr.end) {
      const t = lr.varint();
      const f = t >> 3;
      if (f === 1) name = lr.string();
      else if (f === 2) raw.push(lr.sub());
      else if (f === 3) keys.push(lr.string());
      else if (f === 4) values.push(readValue(lr.sub()));
      else if (f === 5) extent = lr.varint();
      else lr.skip(t & 7);
    }
    const features = raw.map((fr) => {
      let type = 0;
      let tags = [];
      let geom = [];
      while (fr.pos < fr.end) {
        const t = fr.varint();
        const f = t >> 3;
        if (f === 2) tags = fr.packed();
        else if (f === 3) type = fr.varint();
        else if (f === 4) geom = fr.packed();
        else fr.skip(t & 7);
      }
      const props = {};
      for (let k = 0; k < tags.length; k += 2) props[keys[tags[k]]] = values[tags[k + 1]];
      return { type, props, parts: decodeGeometry(geom) };
    });
    layers[name] = { extent, features };
  }
  return layers;
}
