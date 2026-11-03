import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  datIdentifiers,
  indexDat,
  libretroArtwork,
  matchGame,
  normalizeTitle,
  parseDat,
  thumbnailFileName,
  thumbnailUrl,
} from '../src/artwork.ts';
import { IgdbClient } from '../src/igdb.ts';

const DAT = readFileSync(new URL('./data/gba-excerpt.dat', import.meta.url), 'utf8');
const USA_SHA1 = 'b4bd50e4131b027c334547b4524e2dbbd4227130';
const GBA = {
  id: 'gba',
  name: 'Game Boy Advance',
  kind: 'handheld' as const,
  screens: 1,
  aliases: [],
  libretro: { system: 'Nintendo - Game Boy Advance', dat: 'no-intro' as const },
};

describe('libretro DAT', () => {
  const games = parseDat(DAT);

  it('parses game entries, ignoring the header', () => {
    expect(games.map((g) => g.name)).toEqual([
      'Legend of Zelda, The - The Minish Cap (Europe) (En,Fr,De,Es,It)',
      'Legend of Zelda, The - The Minish Cap (USA)',
    ]);
    expect(games[1]).toMatchObject({ region: 'USA', serial: 'BZME' });
    expect(games[1]!.roms[0]).toMatchObject({ crc: 'abcebbb1', sha1: USA_SHA1 });
  });

  it('finds a game by any identifier and lists its siblings', () => {
    const idx = indexDat(games);
    const byCrc = matchGame({ identifiers: [{ kind: 'crc32', value: 'ABCEBBB1' }] }, idx, 'gba');
    expect(byCrc?.name).toBe('Legend of Zelda, The - The Minish Cap (USA)');
    expect(matchGame({ identifiers: [{ kind: 'serial', value: 'bzmp' }] }, idx, 'gba')?.region).toBe('Europe');
    // Identifiers tagged with another platform are ignored
    expect(matchGame({ identifiers: [{ kind: 'sha1', value: USA_SHA1, platform: 'nds' }] }, idx, 'gba')).toBeNull();
    expect(datIdentifiers(byCrc!)).toEqual([
      { kind: 'sha1', value: USA_SHA1, region: 'USA' },
      { kind: 'md5', value: 'a104896da0047abe8bee2a6e3f4c7290', region: 'USA' },
      { kind: 'crc32', value: 'abcebbb1', region: 'USA' },
      { kind: 'serial', value: 'BZME', region: 'USA' },
    ]);
  });

  it('builds libretro-thumbnails URLs with the same character rules', () => {
    expect(thumbnailFileName('Sonic & Knuckles: "Edition" 1/2?')).toBe('Sonic _ Knuckles_ _Edition_ 1_2_');
    expect(thumbnailUrl('Nintendo - Game Boy Advance', 'Named_Boxarts', 'Legend of Zelda, The - The Minish Cap (USA)')).toBe(
      'https://raw.githubusercontent.com/libretro-thumbnails/Nintendo_-_Game_Boy_Advance/master/Named_Boxarts/Legend%20of%20Zelda%2C%20The%20-%20The%20Minish%20Cap%20(USA).png',
    );
  });

  it('keeps only thumbnails that exist', async () => {
    const game = { id: 'x', title: 'x', platforms: ['gba'], identifiers: [{ kind: 'sha1' as const, value: USA_SHA1 }] };
    const match = await libretroArtwork(game, GBA, indexDat(games), async (url) => !url.includes('Named_Titles'));
    expect(match?.media.map((m) => m.kind)).toEqual(['cover', 'screenshot']);
    expect(match?.identifiers.every((i) => i.platform === 'gba' && i.siblingOf === `sha1:${USA_SHA1}`)).toBe(true);
  });

  it('enriches every dump the manifest lists, each tied to its own identifier', async () => {
    const game = {
      id: 'x',
      title: 'x',
      platforms: ['gba'],
      identifiers: [
        { kind: 'sha1' as const, value: USA_SHA1 },
        { kind: 'serial' as const, value: 'BZMP' },
      ],
    };
    const match = await libretroArtwork(game, GBA, indexDat(games), async () => true);
    const crcs = match!.identifiers.filter((i) => i.kind === 'crc32').map((i) => [i.value, i.siblingOf]);
    expect(crcs).toEqual([
      ['abcebbb1', `sha1:${USA_SHA1}`],
      ['e8637292', 'serial:BZMP'],
    ]);
  });
});

describe('IGDB title search', () => {
  it('accepts only an exact normalized title or alternative name', async () => {
    const bodies: string[] = [];
    const fake = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('twitch')) return Response.json({ access_token: 't', expires_in: 3600 });
      bodies.push(String(init?.body));
      return Response.json([
        { id: 1, name: 'The Legend of Zelda: The Minish Cap - Demo' },
        { id: 2, name: 'Zelda no Densetsu: Fushigi no Boushi', alternative_names: [{ name: 'The Legend of Zelda: The Minish Cap' }] },
      ]);
    }) as typeof fetch;
    let token: { token: string; expiresAt: number } | null = null;
    const igdb = new IgdbClient('id', 'secret', { get: async () => token, set: async (v) => void (token = v) }, fake);
    const id = await igdb.resolveId({ id: 'g', title: 'The Legend of Zelda: The Minish Cap', platforms: ['gba'], identifiers: [] }, [24]);
    expect(id).toBe(2);
    expect(bodies[0]).toContain('where platforms = (24)');
    expect(normalizeTitle('Pokémon: Black & White')).toBe('pokemonblackandwhite');
  });
});
