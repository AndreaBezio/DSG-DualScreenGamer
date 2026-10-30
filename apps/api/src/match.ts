import { versionInRange } from '@dsg/schema';

export type TargetRow = {
  platform: string;
  emulator: string | null;
  minVersion: string | null;
  maxVersion: string | null;
  identifiers: { kind: string; value: string }[];
};

export type MatchQuery = {
  platform?: string;
  emulator?: string;
  emulatorVersion?: string;
  /** The identifier the client looked the game up with. */
  identifier?: { kind: string; value: string };
};

/**
 * A target matches when every constraint the client sent is satisfied.
 * A target that names no emulator works with any emulator for that platform;
 * a target with identifiers only applies to those exact dumps.
 */
export function targetMatches(t: TargetRow, q: MatchQuery): boolean {
  if (q.platform && t.platform !== q.platform) return false;
  if (q.emulator && t.emulator && t.emulator !== q.emulator) return false;
  if (q.emulatorVersion && (!q.emulator || t.emulator === q.emulator) && !versionInRange(q.emulatorVersion, t.minVersion, t.maxVersion))
    return false;
  if (q.identifier && t.identifiers.length) {
    const { kind, value } = q.identifier;
    if (!t.identifiers.some((i) => i.kind === kind && i.value === value)) return false;
  }
  return true;
}

export function deviceMatches(modDevices: string[], device?: string): boolean {
  return !device || modDevices.length === 0 || modDevices.includes(device);
}
