/** Loose numeric version compare ("1.6.14" vs "1.6", "v2.0-beta"). Returns -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[^0-9]+/).filter(Boolean).map(Number);
  const pb = b.replace(/^v/i, '').split(/[^0-9]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function versionInRange(version: string, min?: string | null, max?: string | null): boolean {
  if (min && compareVersions(version, min) < 0) return false;
  if (max && compareVersions(version, max) > 0) return false;
  return true;
}
