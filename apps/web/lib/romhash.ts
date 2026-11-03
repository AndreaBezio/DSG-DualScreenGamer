// Hashes a ROM inside the browser, chunk by chunk. The file is never uploaded.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

class Crc32 {
  private c = 0xffffffff;
  update(b: Uint8Array) {
    let c = this.c;
    for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
    this.c = c;
  }
  hex() {
    return ((this.c ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
  }
}

/** Common machinery for the 64-byte block hashes. */
abstract class BlockHash {
  private buf = new Uint8Array(64);
  private len = 0;
  private total = 0;
  protected abstract block(w: DataView): void;
  protected abstract bigEndian: boolean;

  update(data: Uint8Array) {
    this.total += data.length;
    let i = 0;
    if (this.len) {
      const take = Math.min(64 - this.len, data.length);
      this.buf.set(data.subarray(0, take), this.len);
      this.len += take;
      i = take;
      if (this.len === 64) {
        this.block(new DataView(this.buf.buffer));
        this.len = 0;
      }
    }
    for (; i + 64 <= data.length; i += 64) this.block(new DataView(data.buffer, data.byteOffset + i, 64));
    if (i < data.length) {
      this.buf.set(data.subarray(i), 0);
      this.len = data.length - i;
    }
  }

  protected finish() {
    const bits = this.total * 8;
    const pad = new Uint8Array((this.len < 56 ? 56 : 120) - this.len + 8);
    pad[0] = 0x80;
    const v = new DataView(pad.buffer);
    const hi = Math.floor(bits / 2 ** 32);
    const lo = bits >>> 0;
    if (this.bigEndian) {
      v.setUint32(pad.length - 8, hi);
      v.setUint32(pad.length - 4, lo);
    } else {
      v.setUint32(pad.length - 8, lo, true);
      v.setUint32(pad.length - 4, hi, true);
    }
    this.update(pad);
  }
}

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

class Md5 extends BlockHash {
  protected bigEndian = false;
  private h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  private static K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  private static S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

  protected block(w: DataView) {
    let [a, b, c, d] = this.h as [number, number, number, number];
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      b = (b + rotl((a + f + Md5.K[i]! + w.getUint32(g * 4, true)) | 0, Md5.S[(i >> 4) * 4 + (i % 4)]!)) | 0;
      a = tmp;
    }
    this.h = [(this.h[0]! + a) | 0, (this.h[1]! + b) | 0, (this.h[2]! + c) | 0, (this.h[3]! + d) | 0];
  }

  hex() {
    this.finish();
    const out = new DataView(new ArrayBuffer(16));
    this.h.forEach((v, i) => out.setUint32(i * 4, v, true));
    return [...new Uint8Array(out.buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}

class Sha1 extends BlockHash {
  protected bigEndian = true;
  private h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  private w = new Int32Array(80);

  protected block(v: DataView) {
    const w = this.w;
    for (let i = 0; i < 16; i++) w[i] = v.getInt32(i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let [a, b, c, d, e] = this.h as [number, number, number, number, number];
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (rotl(a, 5) + f + e + k + w[i]!) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    this.h = [(this.h[0]! + a) | 0, (this.h[1]! + b) | 0, (this.h[2]! + c) | 0, (this.h[3]! + d) | 0, (this.h[4]! + e) | 0];
  }

  hex() {
    this.finish();
    return this.h.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
  }
}

export type RomHashes = { sha1: string; md5: string; crc32: string; size: number };

/** Hashes everything in one pass over the file; `onProgress` gets 0..1. */
export async function hashRom(file: Blob, onProgress?: (p: number) => void): Promise<RomHashes> {
  const crc = new Crc32();
  const md5 = new Md5();
  const sha1 = new Sha1();
  const reader = file.stream().getReader();
  let done = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    crc.update(value);
    md5.update(value);
    sha1.update(value);
    done += value.length;
    onProgress?.(done / file.size);
  }
  return { sha1: sha1.hex(), md5: md5.hex(), crc32: crc.hex(), size: file.size };
}
