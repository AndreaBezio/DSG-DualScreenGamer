# DSG — Dual Screen Gamer

The reference point for playing on two screens. DSG collects **dual-screen mods, layouts, texture packs and
companion apps** — for the AYN Thor and any two-screen setup, for any platform (DS, 3DS, Wii U, Switch, PC…) —
and exposes them through a **public API that emulators and frontends can use to install mods automatically**,
instead of copying files around by hand.

- **Catalog**: a website styled after a handheld's home menu: framed icon cards, a corner-bracket cursor
  (works with keyboard and gamepad), colored category tabs.
- **API**: `GET /v1/lookup?title_id=…` → which mods exist for the game being booted, with download URLs,
  sha256 checksums and machine-readable install steps. See [docs/api.md](docs/api.md).
- **Game artwork, automatically**: ROM hashes are matched against libretro-database (No-Intro/Redump) for box art,
  screenshots and title screens from libretro-thumbnails, with no API key; IGDB adds covers and screenshots for the rest.
- **Screenshots, automatically**: images in the mod's README, release notes and release assets are collected on
  every sync; pairs like `map-top.png` / `map-bottom.png` are shown as a two-screen preview.
- **Community submissions**: sign in with GitHub or Discord, describe a mod and upload separate top and bottom
  screen screenshots; moderators review it in `/admin` before it is published.
- **Frontend API**: lookups by hash, file name, IGDB / RetroAchievements / ScreenScraper / LaunchBox id, platform
  names as other catalogs spell them, batch lookups, a compact offline index, update checks and feeds.
- **Players and operators**: compatibility reports per device, device pages with real screen specs and
  recommended emulator settings, an anonymous install counter, Discord/JSON webhooks for new mods and releases,
  and Ed25519-signed offline indexes.
- **Registry**: mods are listed through YAML manifests reviewed as pull requests. DSG never re-hosts files:
  it resolves downloads from the authors' GitHub releases. See [docs/manifest.md](docs/manifest.md).

## How games are identified

Emulators don't know catalogue ids; they know a **ROM hash, a title id, a disc serial or a store id**. Every DSG
game has its own id (`stardew-valley`) plus a list of those identifiers, and is linked to
[IGDB](https://www.igdb.com/) (the closest thing to IMDb for games) for title metadata and cover art.

## Layout

```
apps/api       Hono + OpenAPI: the public API (/v1/*), docs at /v1/docs
apps/web       Next.js site with the two-screen UI (i18n via next-intl, English for now)
apps/worker    Syncs registry -> Postgres, GitHub releases (ETag, sha256 digests), IGDB metadata
packages/db    Drizzle schema and migrations (PostgreSQL)
packages/schema  Zod schemas for manifests and website submissions, shared by API, worker and CI
packages/romdb   libretro-database DAT parsing and libretro-thumbnails URLs
registry/      The manifests: catalog/, games/, mods/
```

## Run it with Docker (production)

On the server, alongside the other projects:

```bash
cd ~/Progetti
git clone https://github.com/AndreaBezio/DSG-DualScreenGamer.git
cd DSG-DualScreenGamer
cp .env.example .env   # set POSTGRES_PASSWORD, ADMIN_TOKEN, GITHUB_TOKEN, IGDB_* and public URLs
docker compose up -d --build
```

This starts `db` (Postgres 17), `migrate` (one-shot), `api` on `127.0.0.1:3101`, `worker` and `web` on
`127.0.0.1:3100`. Point your reverse proxy at those two ports (e.g. `dsg.example.org` → 3100,
`api.dsg.example.org` → 3101) and set `PUBLIC_SITE_URL` / `PUBLIC_API_URL` accordingly. If your reverse proxy
runs in Docker, attach `web` and `api` to its network in a `docker-compose.override.yml` instead of publishing ports.

Updating: `git pull && docker compose up -d --build`. Data lives in the `pgdata` volume, uploaded screenshots in
`uploads` (back both up).

**Credentials** (only in `.env`, never committed):

- `GITHUB_TOKEN` — a fine-grained token with no extra permissions; raises the GitHub limit from 60 to 5000 requests/hour.
- `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` — create an application at <https://dev.twitch.tv/console/apps>.
  Without them the site works, just without cover art and summaries.
- `INTERNAL_TOKEN` — shared secret between the website and the API (required).
- `GITHUB_OAUTH_CLIENT_ID/SECRET`, `DISCORD_CLIENT_ID/SECRET` — sign-in for community submissions. Create an OAuth app
  on each site with callback `<PUBLIC_SITE_URL>/auth/callback/github` (or `/discord`). `ADMIN_GITHUB_LOGINS` /
  `ADMIN_DISCORD_IDS` say who becomes admin; admins see the moderation queue at `/admin`.
- `RA_API_KEY` — optional, links dumps to RetroAchievements game ids.
- `INSTALL_SALT` — key for the anonymous daily install dedupe (`openssl rand -hex 32`).
- `INDEX_SIGNING_KEY` — optional Ed25519 key that signs `index.json` / `compact.json`; create it with
  `pnpm keys:generate`. Admins add Discord webhooks at `/admin/webhooks`.
- `ADMIN_TOKEN` — protects `POST /admin/sync`. Add it and `DSG_API_URL` as repository secrets
  (`DSG_ADMIN_TOKEN`, `DSG_API_URL`) so merging a manifest triggers a sync right away.

With `REGISTRY_GIT_URL` set, the worker pulls manifests from git before every sync, so merged mods appear without
rebuilding the image.

## Develop

Requires Node 22, pnpm 10 and a local PostgreSQL.

```bash
pnpm install
export DATABASE_URL=postgres://dsg:dsg@localhost:5432/dsg
pnpm db:migrate
pnpm worker:sync        # registry -> database (+ GitHub/IGDB if credentials are set)
pnpm dev:api            # http://localhost:3001/v1/docs
API_INTERNAL_URL=http://localhost:3001 pnpm dev:web   # http://localhost:3000
```

Checks:

```bash
pnpm registry:validate  # manifests + cross references (add -- --remote to check GitHub too)
pnpm typecheck
TEST_DATABASE_URL=postgres://dsg:dsg@localhost:5432/dsg_test pnpm test
```

After changing `packages/db/src/schema.ts`, run `pnpm db:generate` and commit the new migration.
After changing the manifest schema, run `pnpm registry:schema` to refresh `registry/schema/*.json`.

## Roadmap

- Reference client (`dsg` CLI): hash a ROM → lookup → download → verify sha256 → install
- Import No-Intro/Redump hashes from libretro-database to recognise more dumps
- Integrations with Android frontends and emulators
- More languages (add `apps/web/messages/<locale>.json` and the locale in `apps/web/i18n/request.ts`)
