import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashRom } from '../lib/romhash';

// node:zlib has crc32 since Node 22.2
import { crc32 } from 'node:zlib';

describe('hashRom', () => {
  it.each([0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 1048576 + 3])('matches node:crypto for %i bytes', async (n) => {
    const data = randomBytes(n);
    // Split into odd-sized chunks to exercise the block buffering
    const parts = [];
    for (let i = 0; i < n; i += 7777) parts.push(data.subarray(i, i + 7777));
    const h = await hashRom(new Blob(parts));
    expect(h.sha1).toBe(createHash('sha1').update(data).digest('hex'));
    expect(h.md5).toBe(createHash('md5').update(data).digest('hex'));
    expect(h.crc32).toBe(crc32(data).toString(16).padStart(8, '0'));
    expect(h.size).toBe(n);
  });
});
