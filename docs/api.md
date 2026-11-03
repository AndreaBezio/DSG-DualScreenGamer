# DSG API v1

JSON API for emulators, frontends and launchers. The interactive reference (OpenAPI 3.1) is served at
`/v1/docs`, the raw document at `/v1/openapi.json`.

- No authentication for everything below. CORS is open for `GET` and `POST`.
- **Send a `User-Agent`** that names your app, e.g. `MyEmu/1.2 (+https://example.org)`. Requests without one get `400`.
- Rate limit: 120 requests/minute per IP by default (`RateLimit-*` headers, `429` + `Retry-After` when exceeded).
- Responses are cacheable for 60 s. Error bodies are `{ "error": "…" }`.
- DSG does not host files. Asset URLs point to the authors' GitHub releases. **Verify `sha256`** when it is present.

## The integration in four steps

1. **Identify the game** the user is about to boot: ROM hash (`sha1`, `md5`, `crc32`), `title_id` (Switch, 3DS,
   Wii U), disc `serial`, or store id (`steam_appid`, `gog_id`, `android_pkg`).
2. **Look it up**, telling DSG who you are:
   ```
   GET /v1/lookup?platform=3ds&title_id=00040000000AAAA0&emulator=azahar&emulator_version=2121&device=ayn-thor
   ```
3. **Download** the assets of `latest_release` and check their sha256.
4. **Install** by running the `install` steps in order (see below).

## `GET /v1/lookup`

| Parameter | Meaning |
| --- | --- |
| `sha1` `md5` `crc32` `title_id` `serial` `steam_appid` `gog_id` `android_pkg` | Dump or store identifiers. Several are tried in this order; the first known one wins. Case and `0x` prefixes don't matter. |
| `retroachievements` (or `ra`) `screenscraper` `launchbox` | Game ids in those catalogs, as a frontend knows them after scraping. |
| `igdb` | IGDB game id. Names the game, not a dump: mods restricted to one region still match. |
| `filename` | No-Intro / Redump file name; path and extension are ignored (`/roms/Legend of Zelda, The - The Minish Cap (USA).gba`). |
| `platform` | Platform id or another catalog's name for it (see below). Recommended: avoids CRC32/serial clashes across systems. |
| `emulator`, `emulator_version` | Only mods compatible with this emulator (`/v1/emulators`) and version. |
| `device` | Only mods meant for this device (`/v1/devices`), plus mods with no device restriction. |
| `type` | `dual_screen_layout`, `port`, `texture_pack`, `patch`, `companion_app`, `shader`, `utility`. |

Send at least one identifier, `igdb` or `filename`.

**Naming platforms.** `platform=` accepts DSG's id (`3ds`), an alias (`n3ds`, `psx`, `gamecube`…), or another
catalog's id with a prefix: `igdb:37`, `ra:62` (RetroAchievements console), `screenscraper:17`,
`launchbox:Nintendo 3DS`, `libretro:Nintendo - Nintendo 3DS`, `thegamesdb:4912`. The values come from
`registry/catalog/platforms.yaml`; for nds/3ds/gba/switch/ps2 they match CocoonFE's platform files, so a frontend
can pass its own platform definition straight through.

`200` → `{ game, matched: { kind, value }, mods: Mod[] }`. `404` when DSG doesn't know the game. A known game
with no compatible mod returns `200` with `mods: []`.

Matching rules for a mod's targets: a target that names no emulator works with any emulator on that platform;
`min_version`/`max_version` are compared numerically (`1.6.14 > 1.6`); a target that lists identifiers applies
only to those exact dumps (e.g. one region).

## Other endpoints

| Endpoint | |
| --- | --- |
| `GET /v1/mods/{id}/releases/latest` | Latest release + `install` steps: what a client needs to update a mod. |
| `GET /v1/mods/{id}` · `/v1/mods/{id}/releases` | A mod; all its releases, newest first. |
| `GET /v1/mods?game=&type=&platform=&emulator=&emulator_version=&device=&q=` | Filtered list. |
| `GET /v1/games?q=&platform=&limit=&offset=` · `/v1/games/{id}` | Games with their identifiers. |
| `GET /v1/platforms` · `/v1/emulators` · `/v1/devices` | Catalog. Emulators document their path variables. |
| `GET /v1/index.json` | Everything in one document for offline caches. Send `If-None-Match` with the last `ETag`: `304` when unchanged. |
| `GET /v1/status` | Last sync time and outcome. |
| `POST /v1/lookup/batch` | Up to 500 lookups at once (see below). |
| `GET /v1/index/compact.json` | Every key of every game that has mods (see below). |
| `POST /v1/updates` · `GET /v1/updates?installed=` | Which installed mods have a newer compatible release. |
| `GET /v1/feed.atom` · `/v1/feed.json` | New mods and releases (`?game=&type=&device=`). |
| `GET /v1/devices/{id}` | A device (also by alias): screens, recommended emulator settings with sources, mod count, player reports. |
| `GET /v1/mods/{id}/reports` | Player compatibility reports: summary by device and the latest 20. |
| `POST /v1/mods/{id}/installs` | Count an install (see below). |
| `GET /v1/keys.json` · `/v1/index.json.sig` | Public keys and the detached signature of `index.json`. |
| `GET /v1/mods?sort=popular` | Order by installs in the last 30 days. |

## Player reports, installs

Every mod carries `compat` (`works` / `issues` / `broken`, overall and `by_device`) and `installs`
(`total`, `last_30_days`). Show "verified on your device" from `compat.by_device[<device>]`.

After installing a mod, tell DSG (optional, anonymous, counted once a day per client):

```bash
curl -A "MyEmu/1.0" -X POST https://api.example.org/v1/mods/tmc-android-dual-screen/installs -d '{"device":"ayn-thor"}'
```

DSG keeps no IP address: a client is recognised for one day by an HMAC of its address and user agent under a
key that changes every day.

## Signed indexes

When the server has a signing key, `/v1/index.json` and `/v1/index/compact.json` carry `X-DSG-Signature` (base64
Ed25519 signature of the exact response body) and `X-DSG-Key-Id`. The public keys are at `/v1/keys.json`; ship the
key with your app (or pin its `key_id`) and refuse a cached or mirrored index that does not verify.

```js
import { createPublicKey, verify } from 'node:crypto';
const { keys } = await (await fetch(`${API}/v1/keys.json`)).json();
const res = await fetch(`${API}/v1/index.json`, { headers: { 'User-Agent': 'MyEmu/1.0' } });
const body = Buffer.from(await res.arrayBuffer());
const key = keys.find((k) => k.key_id === res.headers.get('x-dsg-key-id'));
const ok = verify(null, body, createPublicKey(key.public_key_pem), Buffer.from(res.headers.get('x-dsg-signature'), 'base64'));
```

```python
import base64, requests
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
keys = requests.get(f"{API}/v1/keys.json").json()["keys"]
res = requests.get(f"{API}/v1/index.json", headers={"User-Agent": "MyEmu/1.0"})
key = next(k for k in keys if k["key_id"] == res.headers["X-DSG-Key-Id"])
Ed25519PublicKey.from_public_bytes(base64.b64decode(key["public_key"])).verify(
    base64.b64decode(res.headers["X-DSG-Signature"]), res.content)  # raises if tampered
```

## Webhooks (for operators)

Admins add webhooks at `/admin/webhooks`: a Discord channel webhook, or any public https URL that receives JSON
`{ event, mod, release? }` with `X-DSG-Event` and `X-DSG-Signature: sha256=<HMAC-SHA256 of the body with the
webhook's secret>`. Events: `mod_published`, `release_published`, plus `test`. Failed deliveries are retried
after 1, 2 and 4 minutes.

## For frontends with large libraries

**Batch lookup.** Same keys as `/v1/lookup`, one object per game, plus an optional `ref` echoed back:

```bash
curl -A "MyFrontend/1.0" -H 'content-type: application/json' https://api.example.org/v1/lookup/batch -d '{
  "platform": "n3ds", "device": "ayn-thor",
  "items": [
    { "ref": "Zelda.gba", "filename": "Legend of Zelda, The - The Minish Cap (USA).gba" },
    { "ref": 42, "crc32": "ABCEBBB1" },
    { "ref": "game.3ds", "title_id": "0004000000030800" }
  ]
}'
```

The answer has one `results` entry per item, in order (`{ ref, game_id, matched, mod_ids }`), and every matching mod
once in `mods`.

**Compact index.** `GET /v1/index/compact.json` returns `{ keys: { "sha1:…": game_id, "crc32:…": …,
"igdb:1035": … }, games: { game_id: [mod_id, …] } }` for games that have mods. Keep it on the device, refresh it with
`If-None-Match` (`304` when unchanged), and badge "dual-screen mod available" across a whole library without one
request per game.

**Updates.** Send what is installed and get back only what has a newer release that still matches the client:

```bash
curl -A "MyEmu/1.0" "https://api.example.org/v1/updates?installed=tmc-android-dual-screen@1.1&device=ayn-thor"
```

## Integrating DSG into a frontend (e.g. Cocoon)

1. When importing or scraping a library, POST the files to `/v1/lookup/batch` with the best keys you have: the
   ROM hash if you compute one, otherwise the file name (No-Intro sets match by name), the IGDB / ScreenScraper /
   LaunchBox / RetroAchievements id your scraper found, and `platform` in your own naming (`n3ds`, `igdb:37`…).
2. Store the `mod_ids` next to each game; show a badge and the mod's `cover_url` / `previews` (top + bottom screen).
3. On "Install", download `latest_release.assets`, check `sha256`, run `install` (or open `source_url` when
   `manual_download` is true).
4. Periodically call `/v1/updates` with what you installed, and refresh `compact.json`.

## Images

Every game carries `cover_url` (box art), `hero_url` (a wide image for banners) and `media[]`
(`{ kind, url, width, height, source }`, kind `cover` | `screenshot` | `title` | `artwork`, source `igdb` or
`libretro`). Identifiers with `source: "dat"` were added from the libretro-database DAT entry of a dump the manifest
lists, so a lookup by CRC32 finds the same mods as one by SHA-1.

Every mod carries:

- `cover_url`: the best picture for a card or list row (manifest screenshot, preview, found image, or the game cover).
- `previews[]`: `{ top, bottom, caption }` pairs showing both screens at the same moment, for a two-screen preview.
- `media[]`: other screenshots, `{ url, width, height, source, caption }`, where `source` is `manifest`, `release`,
  `readme` or `asset`.

Images are hosted by GitHub (or wherever the author put them); DSG only stores the URLs.

## Install steps

Each mod carries an ordered list of steps. Destinations are **path templates**: the client replaces the variables
with its own folders. Templates always start with a variable and never contain `..`.

| Step | Meaning |
| --- | --- |
| `{ "action": "extract", "asset": "main", "to": "…", "from"?: "sub/dir" }` | Unpack the archive with that role (optionally just one folder of it). |
| `{ "action": "copy", "asset": "main", "to": "…" }` | Copy the file as is. |
| `{ "action": "install_apk", "asset": "companion_apk" }` | Hand the APK to the Android package installer. |
| `{ "action": "note", "text": "…" }` | Show the text to the user. |

Variables:

| Variable | Resolved by the client to |
| --- | --- |
| `{emulator.data_dir}` | The emulator's user/data folder |
| `{emulator.load_dir}` | Folder for per-game mods/patches (e.g. Azahar `load/mods`) |
| `{emulator.textures_dir}` | Custom texture folder |
| `{emulator.mods_dir}` | Mods / graphic packs folder |
| `{emulator.layouts_dir}` | Screen layout folder |
| `{game.dir}` | The game's install folder (PC/native) |
| `{game.mods_dir}` | The game's mod folder (e.g. Stardew Valley `Mods/`, used by SMAPI) |
| `{game.title_id}` · `{game.serial}` | The matched identifier |

`/v1/emulators` describes what each emulator's variables mean in `paths`.

## Example

```bash
curl -A "MyEmu/1.0" "https://api.example.org/v1/lookup?platform=pc&steam_appid=413150&device=ayn-thor"
```

```json
{
  "game": { "id": "stardew-valley", "title": "Stardew Valley", "identifiers": [ … ], "mod_count": 1 },
  "matched": { "kind": "steam_appid", "value": "413150" },
  "mods": [
    {
      "id": "stardew-valley-dual-screen",
      "type": "companion_app",
      "devices": ["ayn-thor"],
      "targets": [{ "platform": "pc", "emulator": "smapi", "min_version": "4.0", … }],
      "install": [
        { "action": "extract", "asset": "main", "to": "{game.mods_dir}" },
        { "action": "install_apk", "asset": "companion_apk" }
      ],
      "latest_release": {
        "version": "2.0",
        "assets": [{ "role": "main", "name": "….zip", "url": "https://github.com/…", "size": 812000, "sha256": "…" }]
      }
    }
  ]
}
```
