# DSG registry

Every game and mod listed on DSG is a YAML file in this folder. Changes arrive as pull requests,
are validated by CI, and are synced into the database by the worker after merge.

- `catalog/` — platforms, emulators/mod loaders/frontends, dual-screen devices
- `games/<id>.yaml` — a game and the identifiers emulators recognise it by
- `mods/<id>.yaml` — a mod: where its releases live, what it targets, how to install it
- `schema/` — generated JSON Schemas (`pnpm registry:schema`) for editor autocompletion

How to write a manifest: [docs/manifest.md](../docs/manifest.md).
