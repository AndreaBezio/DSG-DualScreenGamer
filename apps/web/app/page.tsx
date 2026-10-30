import { getTranslations } from 'next-intl/server';
import { HomeMenu, type MenuItem } from '@/components/HomeMenu';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const tt = await getTranslations('types');
  const index = await api.index();
  const platformName = new Map(index.platforms.map((p) => [p.id, p.name]));
  const deviceName = new Map(index.devices.map((d) => [d.id, d.name]));
  const gameById = new Map(index.games.map((g) => [g.id, g]));

  const mods: MenuItem[] = index.mods.map((m) => {
    const game = m.game_id ? gameById.get(m.game_id) : undefined;
    return {
      key: `mod:${m.id}`,
      kind: 'mod',
      id: m.id,
      title: m.name,
      type: m.type,
      cover: m.screenshots[0] ?? game?.cover_url ?? null,
      href: `/mods/${m.id}`,
      summary: m.summary,
      gameTitle: game?.title,
      version: m.latest_release?.version,
      meta: [
        ...new Set(m.targets.map((t) => platformName.get(t.platform) ?? t.platform)),
        ...m.devices.map((d) => deviceName.get(d) ?? d),
      ],
    };
  });
  const games: MenuItem[] = index.games.map((g) => ({
    key: `game:${g.id}`,
    kind: 'game',
    id: g.id,
    title: g.title,
    type: 'game',
    cover: g.cover_url,
    href: `/games/${g.id}`,
    summary: g.summary ?? tt('game'),
    meta: g.platforms.map((p) => platformName.get(p) ?? p),
  }));

  return <HomeMenu items={[...mods, ...games]} stats={{ games: games.length, mods: mods.length }} />;
}
