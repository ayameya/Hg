import { openSync, readSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const fd = openSync(process.argv[2], "r");
const read = (off, len) => {
  const b = Buffer.alloc(len);
  readSync(fd, b, 0, len, off);
  return b;
};
const u64 = (b, o) => b.readUInt32LE(o + 4) * 4294967296 + b.readUInt32LE(o);
const head = read(0, 127);
const h = { rootOff: u64(head, 8), rootLen: u64(head, 16), leafOff: u64(head, 40), dataOff: u64(head, 56), ic: head[97] };

function varint(buf, pos) {
  let r = 0;
  let s = 1;
  for (;;) {
    const b = buf[pos.i++];
    r += (b & 0x7f) * s;
    if (b < 0x80) return r;
    s *= 128;
  }
}

function dir(off, len) {
  let b = read(off, len);
  if (h.ic === 2) b = gunzipSync(b);
  const pos = { i: 0 };
  const n = varint(b, pos);
  const e = [];
  let last = 0;
  for (let i = 0; i < n; i++) e.push({ id: (last += varint(b, pos)) });
  for (const x of e) x.run = varint(b, pos);
  for (const x of e) x.len = varint(b, pos);
  for (let i = 0; i < n; i++) {
    const v = varint(b, pos);
    e[i].off = v === 0 && i > 0 ? e[i - 1].off + e[i - 1].len : v - 1;
  }
  return e;
}

function zoomOf(id) {
  let acc = 0;
  for (let z = 0; z < 32; z++) {
    const n = 4 ** z;
    if (id < acc + n) return z;
    acc += n;
  }
  return -1;
}

const per = {};
function walk(entries) {
  for (const e of entries) {
    if (e.run === 0) walk(dir(h.leafOff + e.off, e.len));
    else {
      const z = zoomOf(e.id);
      const s = (per[z] ||= { n: 0, sum: 0, max: 0, sizes: [] });
      s.n += e.run;
      s.sum += e.len * e.run;
      s.max = Math.max(s.max, e.len);
      s.sizes.push(e.len);
    }
  }
}
walk(dir(h.rootOff, h.rootLen));
for (const [z, s] of Object.entries(per)) {
  s.sizes.sort((a, b) => a - b);
  const p95 = s.sizes[Math.floor(s.sizes.length * 0.95)];
  console.log(`z${z}: ${s.n} tiles, avg ${(s.sum / s.n / 1024).toFixed(0)} KB, p95 ${(p95 / 1024).toFixed(0)} KB, max ${(s.max / 1024).toFixed(0)} KB`);
}
