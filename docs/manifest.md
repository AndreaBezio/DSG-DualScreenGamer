# Adding a mod to DSG

Mods are listed with YAML files in [`registry/`](../registry). You open a pull request, CI validates it, and once
merged the worker picks up your GitHub releases automatically, including every future release.

DSG **links to your GitHub releases**; it never copies your files. Attach the files you want people to download
to a release (`.zip`, `.apk`, `.json`…).

## 1. The game: `registry/games/<id>.yaml`

Skip this if the game already exists.

```yaml
# yaml-language-server: $schema=../schema/game.schema.json
id: my-game              # lowercase-kebab-case, same as the file name
title: My Game
platforms: [3ds]         # ids from registry/catalog/platforms.yaml
igdb: 12345              # optional: IGDB id. Found automatically from steam_appid / gog_id / android_pkg
identifiers:             # what emulators recognise the game by
  - { kind: title_id, value: "00040000000AAAA0", platform: 3ds, region: USA }
  - { kind: title_id, value: "00040000000BBBB0", platform: 3ds, region: EUR }
```

| `kind` | Format | Example |
| --- | --- | --- |
| `sha1` / `md5` / `crc32` | hex of the ROM dump (prefer No-Intro/Redump dumps) | `crc32: 3e6d9b0c` |
| `title_id` | 16 hex digits (Switch, 3DS, Wii U) | `0100ABCD00010000` |
| `serial` | disc serial | `SLUS-20062` |
| `steam_appid` / `gog_id` | store id | `413150` |
| `android_pkg` | package name | `com.example.game` |

Each identifier can belong to only one game. Add one per region/revision your mod supports.

## 2. The mod: `registry/mods/<id>.yaml`

```yaml
# yaml-language-server: $schema=../schema/mod.schema.json
id: my-game-thor-layout
name: My Game — Thor layout
type: dual_screen_layout  # dual_screen_layout | texture_pack | patch | companion_app | shader | utility
summary: Map on the bottom screen, action on top.   # max 200 chars
description: |            # optional, blank lines separate paragraphs
  Longer explanation.
game: my-game             # required unless type is utility
authors: [{ name: Your Name, github: your-user }]
license: MIT              # SPDX id, or "unknown"
homepage: https://github.com/your-user/my-game-thor-layout
tags: [layout]
screenshots: [https://…/shot.png]   # first one is used as the tile art
requires: ["Azahar 2120 or later"]   # shown to users
devices: [ayn-thor]       # leave empty if it works on any dual-screen setup

source:
  github: your-user/my-game-thor-layout
  assets:                 # globs on release asset names; first match decides the role
    - { role: main, pattern: "*.zip" }
    - { role: companion_apk, pattern: "*.apk" }
  prereleases: false      # include GitHub pre-releases
  tag_pattern: "layout-*" # optional, when one repo publishes several mods

targets:                  # where it works; a client must match at least one
  - platform: 3ds
    emulator: azahar      # optional: any emulator if omitted
    min_version: "2120"   # optional
    identifiers:          # optional: only these dumps (must be listed in the game file)
      - { kind: title_id, value: "00040000000AAAA0" }

install:                  # what a client does, in order
  - { action: extract, asset: main, to: "{emulator.load_dir}/{game.title_id}" }
  - { action: note, text: "Pick the 'Thor' layout in the emulator settings." }
```

Install actions: `extract` (with optional `from` to take one folder of the archive), `copy`, `install_apk`, `note`.
Destinations must start with a variable: `{emulator.data_dir}`, `{emulator.load_dir}`, `{emulator.textures_dir}`,
`{emulator.mods_dir}`, `{emulator.layouts_dir}`, `{game.dir}`, `{game.mods_dir}`, `{game.title_id}`,
`{game.serial}`. See [api.md](api.md#install-steps).

Missing an emulator, platform or device? Add it to `registry/catalog/` in the same pull request.

## 3. Validate and open the pull request

```bash
pnpm install
pnpm registry:validate             # schema + cross references
pnpm registry:validate -- --remote # also checks your repo and that a release has matching assets
```

Editors with the YAML language server (VS Code "YAML" extension) autocomplete fields thanks to the `$schema` line.
