import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveReleases, versionFromTag } from '../src/github.ts';
import { matchesGlob } from '../src/glob.ts';
import { loadRegistry } from '../src/registry.ts';
import { registry, releases } from './fixtures.ts';

describe('glob', () => {
  it('matches asset names', () => {
    expect(matchesGlob('Mod-v2.ZIP', '*.zip')).toBe(true);
    expect(matchesGlob('layout.json', '*.{json,zip}')).toBe(true);
    expect(matchesGlob('notes.txt', '*.{json,zip}')).toBe(false);
    expect(matchesGlob('a.b.zip', 'a?b.zip')).toBe(true);
  });
});

describe('resolveReleases', () => {
  it('filters prereleases, keeps matching assets, reads sha256 digests, sorts newest first', () => {
    const r = resolveReleases(registry.mods[0]!, releases['tester/test-quest-hd']!);
    expect(r.map((x) => x.tag)).toEqual(['v1.1.0', 'v1.0.0']);
    expect(r[0]!.assets).toHaveLength(1);
    expect(r[0]!.assets[0]!.sha256).toBe('b'.repeat(64));
    expect(r[1]!.assets[0]!.sha256).toBeNull();
  });

  it('includes prereleases when allowed and honours tag_pattern', () => {
    const mod = { source: { ...registry.mods[0]!.source, prereleases: true, tag_pattern: 'v1.2*' } };
    expect(resolveReleases(mod, releases['tester/test-quest-hd']!).map((x) => x.tag)).toEqual(['v1.2.0-beta']);
  });

  it('extracts versions from tags', () => {
    expect(versionFromTag('v2.0.1')).toBe('2.0.1');
    expect(versionFromTag('stardew-2.0')).toBe('2.0');
    expect(versionFromTag('nightly')).toBe('nightly');
  });
});

describe('loadRegistry', () => {
  it('accepts the bundled registry', () => {
    const { errors, registry: reg } = loadRegistry(fileURLToPath(new URL('../../../registry', import.meta.url)));
    expect(errors).toEqual([]);
    expect(reg.mods.length).toBeGreaterThan(0);
  });

  it('reports broken cross references', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsg-reg-'));
    for (const d of ['catalog', 'games', 'mods']) mkdirSync(join(root, d));
    writeFileSync(join(root, 'catalog/platforms.yaml'), '- { id: nds, name: DS, kind: handheld }\n');
    writeFileSync(join(root, 'catalog/emulators.yaml'), '- { id: melonds, name: melonDS, platforms: [nds], os: [android] }\n');
    writeFileSync(join(root, 'catalog/devices.yaml'), '[]\n');
    writeFileSync(
      join(root, 'mods/wrong-name.yaml'),
      [
        'id: some-mod',
        'name: Some mod',
        'type: patch',
        'summary: x',
        'game: missing-game',
        'authors: [{ name: a }]',
        'license: MIT',
        'devices: [ghost-device]',
        'source: { github: a/b, assets: [{ role: main, pattern: "*" }] }',
        'targets: [{ platform: nds, emulator: azahar }]',
      ].join('\n'),
    );
    const { errors } = loadRegistry(root);
    expect(errors.join('\n')).toMatch(/file name must match/);
    expect(errors.join('\n')).toMatch(/unknown game "missing-game"/);
    expect(errors.join('\n')).toMatch(/unknown device "ghost-device"/);
    expect(errors.join('\n')).toMatch(/unknown emulator "azahar"/);
  });
});
