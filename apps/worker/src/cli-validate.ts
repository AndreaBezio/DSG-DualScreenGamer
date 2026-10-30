// Validates the registry. Used locally and by CI on every pull request.
// --remote also checks that each GitHub repo exists and has usable releases.
import { fileURLToPath } from 'node:url';
import { GitHubClient, resolveReleases } from './github.ts';
import { loadRegistry } from './registry.ts';

const root = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? fileURLToPath(new URL('../../../registry', import.meta.url));
const { registry, errors } = loadRegistry(root);
const warnings: string[] = [];

if (process.argv.includes('--remote')) {
  const gh = new GitHubClient();
  for (const m of registry.mods) {
    try {
      if (!(await gh.repo(m.source.github))) {
        errors.push(`mod ${m.id}: GitHub repo ${m.source.github} not found`);
        continue;
      }
      const res = await gh.releases(m.source.github);
      if (!res.notModified && resolveReleases(m, res.releases).length === 0) {
        warnings.push(`mod ${m.id}: no release has assets matching ${m.source.assets.map((a) => a.pattern).join(', ')}`);
      }
    } catch (e) {
      warnings.push(`mod ${m.id}: ${(e as Error).message}`);
    }
  }
}

for (const w of warnings) console.warn(`warning: ${w}`);
for (const e of errors) console.error(`error: ${e}`);
console.log(
  `${registry.games.length} game(s), ${registry.mods.length} mod(s), ${errors.length} error(s), ${warnings.length} warning(s)`,
);
process.exit(errors.length ? 1 : 0);
