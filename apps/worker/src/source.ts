import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BUNDLED = fileURLToPath(new URL('../../../registry', import.meta.url));

/**
 * Where manifests come from: a git checkout kept up to date (REGISTRY_GIT_URL),
 * a mounted folder (REGISTRY_DIR) or the copy bundled with this repo.
 */
export function prepareRegistry(): string {
  const gitUrl = process.env.REGISTRY_GIT_URL;
  if (!gitUrl) return process.env.REGISTRY_DIR ?? BUNDLED;

  const checkout = process.env.REGISTRY_CHECKOUT_DIR ?? '/data/registry-repo';
  const branch = process.env.REGISTRY_GIT_BRANCH ?? 'main';
  if (!existsSync(`${checkout}/.git`)) {
    execFileSync('git', ['clone', '--depth', '1', '--branch', branch, gitUrl, checkout], { stdio: 'inherit' });
  } else {
    execFileSync('git', ['-C', checkout, 'fetch', '--depth', '1', 'origin', branch], { stdio: 'inherit' });
    execFileSync('git', ['-C', checkout, 'reset', '--hard', `origin/${branch}`], { stdio: 'inherit' });
  }
  return `${checkout}/${process.env.REGISTRY_GIT_SUBDIR ?? 'registry'}`;
}
