import type { GameManifest } from '@dsg/schema';
import { normalizeTitle } from './artwork.ts';
import type { FetchLike } from './github.ts';

/** IGDB external_game_source ids for the identifier kinds we can map. */
const EXTERNAL_SOURCES: Partial<Record<string, number>> = {
  steam_appid: 1,
  gog_id: 5,
  android_pkg: 15,
};

export type IgdbGame = {
  id: number;
  name: string;
  summary?: string;
  first_release_date?: number;
  cover?: { image_id: string; width?: number; height?: number };
  screenshots?: { image_id: string; width?: number; height?: number }[];
  artworks?: { image_id: string; width?: number; height?: number }[];
};

export type TokenStore = {
  get(): Promise<{ token: string; expiresAt: number } | null>;
  set(v: { token: string; expiresAt: number }): Promise<void>;
};

export class IgdbClient {
  constructor(
    private clientId: string,
    private clientSecret: string,
    private store: TokenStore,
    private fetchImpl: FetchLike = fetch,
  ) {}

  static fromEnv(store: TokenStore): IgdbClient | null {
    const id = process.env.IGDB_CLIENT_ID;
    const secret = process.env.IGDB_CLIENT_SECRET;
    return id && secret ? new IgdbClient(id, secret, store) : null;
  }

  private async token(): Promise<string> {
    const cached = await this.store.get();
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const url = new URL('https://id.twitch.tv/oauth2/token');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('client_secret', this.clientSecret);
    url.searchParams.set('grant_type', 'client_credentials');
    const res = await this.fetchImpl(url, { method: 'POST' });
    if (!res.ok) throw new Error(`Twitch OAuth: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    const value = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    await this.store.set(value);
    return value.token;
  }

  async query<T>(endpoint: string, body: string): Promise<T> {
    const res = await this.fetchImpl(`https://api.igdb.com/v4/${endpoint}`, {
      method: 'POST',
      headers: { 'Client-ID': this.clientId, Authorization: `Bearer ${await this.token()}`, Accept: 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`IGDB ${endpoint}: HTTP ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  /**
   * Finds the IGDB id: store ids first (Steam, GOG, Play Store), then a title search
   * restricted to the game's platforms that only accepts an exact (normalized) name match.
   */
  async resolveId(game: GameManifest, platformIds: number[] = []): Promise<number | null> {
    if (game.igdb) return game.igdb;
    for (const i of game.identifiers) {
      const source = EXTERNAL_SOURCES[i.kind];
      if (!source) continue;
      const rows = await this.query<{ game?: number }[]>(
        'external_games',
        `fields game; where uid = "${i.value.replace(/"/g, '')}" & external_game_source = ${source}; limit 1;`,
      );
      if (rows[0]?.game) return rows[0].game;
    }
    const title = game.title.replace(/"/g, '');
    const where = platformIds.length ? ` where platforms = (${platformIds.join(',')});` : '';
    const found = await this.query<{ id: number; name: string; alternative_names?: { name: string }[] }[]>(
      'games',
      `search "${title}"; fields id,name,alternative_names.name;${where} limit 10;`,
    );
    const wanted = normalizeTitle(game.title);
    const hit = found.find(
      (g) => normalizeTitle(g.name) === wanted || g.alternative_names?.some((a) => normalizeTitle(a.name) === wanted),
    );
    return hit?.id ?? null;
  }

  async game(id: number): Promise<IgdbGame | null> {
    const rows = await this.query<IgdbGame[]>(
      'games',
      `fields name,summary,first_release_date,cover.image_id,cover.width,cover.height,screenshots.image_id,screenshots.width,screenshots.height,artworks.image_id,artworks.width,artworks.height; where id = ${id};`,
    );
    return rows[0] ?? null;
  }
}

export function igdbImageUrl(imageId: string, size: string): string {
  return `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`;
}

export function igdbCoverUrl(imageId: string, size = 't_cover_big'): string {
  return `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`;
}
