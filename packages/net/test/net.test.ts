import { describe, expect, it } from 'vitest';
import { guardedFetch, isPrivateAddress, isPublicUrl, looksPublic } from '../src/index.ts';

describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.20.0.5', true],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['::1', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['::ffff:10.0.0.1', true],
    ['8.8.8.8', false],
    ['140.82.112.3', false],
    ['2606:4700::1111', false],
    ['::ffff:8.8.8.8', false],
  ])('%s -> %s', (ip, priv) => expect(isPrivateAddress(ip)).toBe(priv));
});

describe('isPublicUrl', () => {
  const dns = (map: Record<string, string[]>) => async (h: string) => {
    if (!map[h]) throw new Error('ENOTFOUND');
    return map[h]!;
  };

  it('needs https and public addresses for every resolved IP', async () => {
    const r = dns({ 'files.example.org': ['93.184.216.34'], 'sneaky.example.org': ['93.184.216.34', '10.0.0.7'], 'intranet.example.org': ['192.168.0.10'] });
    expect(await isPublicUrl('https://files.example.org/a.zip', r)).toBe(true);
    expect(await isPublicUrl('http://files.example.org/a.zip', r)).toBe(false);
    expect(await isPublicUrl('https://sneaky.example.org/', r)).toBe(false);
    expect(await isPublicUrl('https://intranet.example.org/', r)).toBe(false);
    expect(await isPublicUrl('https://unknown.example.org/', r)).toBe(false);
    expect(await isPublicUrl('https://127.0.0.1/', r)).toBe(false);
    expect(await isPublicUrl('https://[::1]/', r)).toBe(false);
    expect(looksPublic('https://localhost:3001/')).toBe(false);
    expect(looksPublic('https://user:pw@files.example.org/')).toBe(false);
  });

  it('checks every redirect hop', async () => {
    const fake = (async (u: string | URL | Request) => {
      const url = String(u);
      if (url === 'https://a.test/file') return new Response(null, { status: 302, headers: { location: 'https://b.test/file' } });
      if (url === 'https://a.test/evil') return new Response(null, { status: 302, headers: { location: 'https://internal.test/' } });
      return new Response('ok');
    }) as typeof fetch;
    const guard = async (u: string) => !u.includes('internal.test');
    expect(await (await guardedFetch('https://a.test/file', {}, { fetch: fake, guard })).text()).toBe('ok');
    await expect(guardedFetch('https://a.test/evil', {}, { fetch: fake, guard })).rejects.toThrow(/non-public/);
  });
});
