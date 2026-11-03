// Shared by server and client components: the preview frame's proportions for a device.
import type { CSSProperties } from 'react';
import type { Display } from './api';

/** Used when no device data is available: the AYN Thor. */
export const THOR: Display[] = [
  { role: 'top', width: 1920, height: 1080, diagonal_in: 6 },
  { role: 'bottom', width: 1240, height: 1080, diagonal_in: 3.92 },
];

/** Screen shapes and the bottom screen's width relative to the top one, from physical sizes when known. */
export function frameStyle(displays: Display[]): CSSProperties {
  const top = displays.find((d) => d.role === 'top') ?? THOR[0]!;
  const bottom = displays.find((d) => d.role === 'bottom') ?? THOR[1]!;
  const physicalWidth = (d: Display) => (d.diagonal_in ? (d.diagonal_in * d.width) / Math.hypot(d.width, d.height) : null);
  const tw = physicalWidth(top);
  const bw = physicalWidth(bottom);
  // Same physical height if diagonals are unknown
  const ratio = tw && bw ? bw / tw : bottom.width / bottom.height / (top.width / top.height);
  return {
    ['--top-ar' as string]: `${top.width} / ${top.height}`,
    ['--bottom-ar' as string]: `${bottom.width} / ${bottom.height}`,
    ['--bottom-w' as string]: `${Math.round(Math.min(1, Math.max(0.3, ratio)) * 1000) / 10}%`,
  };
}

