import { describe, expect, it } from 'vitest';
import { compareVersions, ModManifest, normalizeIdentifier, versionInRange } from '../src/index.ts';

const base = {
  id: 'example-pack',
  name: 'Example Pack',
  type: 'texture_pack',
  summary: 'HD textures',
  game: 'example-game',
  authors: [{ name: 'someone' }],
  license: 'MIT',
  source: { github: 'someone/example-pack', assets: [{ role: 'main', pattern: '*.zip' }] },
  targets: [{ platform: '3ds', emulator: 'azahar' }],
  install: [{ action: 'extract', asset: 'main', to: '{emulator.textures_dir}/{game.title_id}' }],
};

describe('ModManifest', () => {
  it('accepts a valid manifest and fills defaults', () => {
    const m = ModManifest.parse(base);
    expect(m.tags).toEqual([]);
    expect(m.source.prereleases).toBe(false);
  });

  it.each([
    ['path traversal', { install: [{ action: 'extract', asset: 'main', to: '{game.dir}/../etc' }] }],
    ['unknown path variable', { install: [{ action: 'copy', asset: 'main', to: '{emulator.home}/x' }] }],
    ['absolute path', { install: [{ action: 'copy', asset: 'main', to: '/sdcard/x' }] }],
    ['undeclared asset role', { install: [{ action: 'install_apk', asset: 'companion_apk' }] }],
    ['missing game', { game: undefined }],
    ['bad repo', { source: { github: 'not a repo', assets: [{ role: 'main', pattern: '*' }] } }],
    ['unknown field', { stars: 5 }],
  ])('rejects %s', (_, patch) => {
    expect(ModManifest.safeParse({ ...base, ...patch }).success).toBe(false);
  });

  it('lets utilities omit the game', () => {
    expect(ModManifest.safeParse({ ...base, type: 'utility', game: undefined }).success).toBe(true);
  });
});

describe('identifiers', () => {
  it('normalizes casing and prefixes', () => {
    expect(normalizeIdentifier('sha1', ' ABCDEF ')).toBe('abcdef');
    expect(normalizeIdentifier('crc32', '0xDEADBEEF')).toBe('deadbeef');
    expect(normalizeIdentifier('title_id', '0004000000030800'.toLowerCase())).toBe('0004000000030800');
    expect(normalizeIdentifier('serial', 'slus 20062')).toBe('SLUS-20062');
  });
});

describe('versions', () => {
  it('compares loosely', () => {
    expect(compareVersions('1.6.14', '1.6')).toBe(1);
    expect(compareVersions('v2.0', '2')).toBe(0);
    expect(compareVersions('2.0-beta', '2.1')).toBe(-1);
    expect(versionInRange('4.1', '4.0', null)).toBe(true);
    expect(versionInRange('3.9', '4.0', undefined)).toBe(false);
  });
});
