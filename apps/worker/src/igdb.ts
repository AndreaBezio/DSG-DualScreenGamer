import type { GameManifest } from '@dsg/schema';
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
  cover?: { image_id: string };
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

  /** Finds the IGDB id through store ids (Steam, GOG, Play Store) declared in the manifest. */
  async resolveId(game: GameManifest): Promise<number | null> {
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
    return null;
  }

  async game(id: number): Promise<IgdbGame | null> {
    const rows = await this.query<IgdbGame[]>(
      'games',
      `fields name,summary,first_release_date,cover.image_id; where id = ${id};`,
    );
    return rows[0] ?? null;
  }
}

export function igdbCoverUrl(imageId: string, size = 't_cover_big'): string {
  return `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`;
}
