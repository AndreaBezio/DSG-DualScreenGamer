## What does this add?

<!-- New mod / new game / fix to an existing manifest / code change -->

## Checklist for new mods

- [ ] The mod is published as a GitHub release with the files attached
- [ ] `registry/mods/<id>.yaml` file name matches its `id`
- [ ] The game exists in `registry/games/` (or is added in this PR) with identifiers emulators can match (hash, title id, serial…)
- [ ] `pnpm registry:validate` passes
- [ ] I am the author, or the author agrees to being listed
