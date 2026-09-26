function readVarint(buf, pos) {
  let result = 0;
  let shift = 1;
  for (;;) {
    const b = buf[pos.i++];
    result += (b & 0x7f) * shift;
    if (b < 0x80) return result;
    shift *= 128;
  }
}

function u64(view, off) {
  return view.getUint32(off + 4, true) * 4294967296 + view.getUint32(off, true);
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function rotate(n, xy, rx, ry) {
  if (ry === 0) {
    if (rx === 1) {
      xy[0] = n - 1 - xy[0];
      xy[1] = n - 1 - xy[1];
    }
    const t = xy[0];
    xy[0] = xy[1];
    xy[1] = t;
  }
}

export function zxyToTileId(z, x, y) {
  let acc = 0;
  for (let a = 0; a < z; a++) acc += 4 ** a;
  const xy = [x, y];
  let d = 0;
  for (let s = 2 ** (z - 1); s >= 1; s /= 2) {
    const rx = (xy[0] & s) > 0 ? 1 : 0;
    const ry = (xy[1] & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    rotate(s, xy, rx, ry);
  }
  return acc + d;
}

function parseDirectory(bytes) {
  const pos = { i: 0 };
  const n = readVarint(bytes, pos);
  const entries = new Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last += readVarint(bytes, pos);
    entries[i] = { tileId: last, offset: 0, length: 0, runLength: 1 };
  }
  for (let i = 0; i < n; i++) entries[i].runLength = readVarint(bytes, pos);
  for (let i = 0; i < n; i++) entries[i].length = readVarint(bytes, pos);
  for (let i = 0; i < n; i++) {
    const v = readVarint(bytes, pos);
    entries[i].offset = v === 0 && i > 0 ? entries[i - 1].offset + entries[i - 1].length : v - 1;
  }
  return entries;
}

function findEntry(entries, tileId) {
  let lo = 0;
  let hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = tileId - entries[mid].tileId;
    if (c > 0) lo = mid + 1;
    else if (c < 0) hi = mid - 1;
    else return entries[mid];
  }
  if (hi >= 0) {
    const e = entries[hi];
    if (e.runLength === 0) return e;
    if (tileId - e.tileId < e.runLength) return e;
  }
  return null;
}

export class PMTiles {
  constructor(url) {
    this.url = url;
    this.dirCache = new Map();
    this.ready = this.init();
  }

  async range(offset, length) {
    const res = await fetch(this.url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length > length ? buf.subarray(offset, offset + length) : buf;
  }

  async init() {
    const head = await this.range(0, 16384);
    const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if (String.fromCharCode(...head.subarray(0, 7)) !== "PMTiles" || head[7] !== 3) throw new Error("PMTiles v3 only");
    this.h = {
      rootOffset: u64(v, 8),
      rootLength: u64(v, 16),
      leafOffset: u64(v, 40),
      dataOffset: u64(v, 56),
      internalCompression: head[97],
      tileCompression: head[98],
      minZoom: head[100],
      maxZoom: head[101],
    };
    let root = head.subarray(this.h.rootOffset, this.h.rootOffset + this.h.rootLength);
    if (this.h.internalCompression === 2) root = await gunzip(root);
    this.root = parseDirectory(root);
  }

  async leaf(offset, length) {
    const key = `${offset}:${length}`;
    if (!this.dirCache.has(key)) {
      this.dirCache.set(key, (async () => {
        let bytes = await this.range(this.h.leafOffset + offset, length);
        if (this.h.internalCompression === 2) bytes = await gunzip(bytes);
        return parseDirectory(bytes);
      })());
    }
    return this.dirCache.get(key);
  }

  async tile(z, x, y) {
    await this.ready;
    const id = zxyToTileId(z, x, y);
    let dir = this.root;
    for (let depth = 0; depth < 4; depth++) {
      const e = findEntry(dir, id);
      if (!e) return null;
      if (e.runLength > 0) {
        let bytes = await this.range(this.h.dataOffset + e.offset, e.length);
        if (this.h.tileCompression === 2) bytes = await gunzip(bytes);
        return bytes;
      }
      dir = await this.leaf(e.offset, e.length);
    }
    return null;
  }
}
