# DSG API v1

Read-only JSON API for emulators, frontends and launchers. The interactive reference (OpenAPI 3.1) is served at
`/v1/docs`, the raw document at `/v1/openapi.json`.

- No authentication. CORS is open for `GET`.
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
| `sha1` `md5` `crc32` `title_id` `serial` `steam_appid` `gog_id` `android_pkg` | At least one. Several are tried in this order; the first known one wins. Case and `0x` prefixes don't matter. |
| `platform` | Platform id (`/v1/platforms`). Recommended: avoids CRC32/serial clashes across systems. |
| `emulator`, `emulator_version` | Only mods compatible with this emulator (`/v1/emulators`) and version. |
| `device` | Only mods meant for this device (`/v1/devices`), plus mods with no device restriction. |
| `type` | `dual_screen_layout`, `texture_pack`, `patch`, `companion_app`, `shader`, `utility`. |

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

## Images

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
