'use client';

import { useTranslations } from 'next-intl';
import { useState, type CSSProperties } from 'react';
import type { Display, Preview } from '@/lib/api';
import { Icon } from './Icon';

export type PreviewDevice = { id: string; name: string; displays: Display[] };

/** Used when no device data is available: the AYN Thor. */
const THOR: Display[] = [
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

/**
 * How the mod looks on a two-screen handheld: the top screen above, the second below,
 * drawn at the real proportions of the chosen device.
 */
export function DualScreenPreview({ previews, devices = [] }: { previews: Preview[]; devices?: PreviewDevice[] }) {
  const t = useTranslations('preview');
  const [i, setI] = useState(0);
  const usable = devices.filter((d) => d.displays.length >= 2);
  const [deviceId, setDeviceId] = useState(usable[0]?.id);
  if (!previews.length) return null;
  const current = previews[i % previews.length]!;
  const device = usable.find((d) => d.id === deviceId);

  return (
    <figure className="dsp" style={frameStyle(device?.displays ?? THOR)}>
      <div className="dsp-device">
        <div className="dsp-screen dsp-top">
          <img src={current.top.url} alt={current.caption ?? t('top')} />
        </div>
        <div className="dsp-hinge" aria-hidden />
        <div className="dsp-screen dsp-bottom">
          <img src={current.bottom.url} alt={t('bottom')} />
        </div>
      </div>
      <figcaption className="dsp-caption">
        {previews.length > 1 ? (
          <button type="button" className="icon-btn" data-nav aria-label={t('prev')} onClick={() => setI((i - 1 + previews.length) % previews.length)}>
            <Icon name="back" size={16} />
          </button>
        ) : null}
        <span>
          {current.caption ?? t('title')}
          {previews.length > 1 ? <span className="muted"> · {i + 1}/{previews.length}</span> : null}
        </span>
        {previews.length > 1 ? (
          <button type="button" className="icon-btn" data-nav aria-label={t('next')} onClick={() => setI((i + 1) % previews.length)}>
            <Icon name="next" size={16} />
          </button>
        ) : null}
        {usable.length > 1 ? (
          <select className="dsp-device-pick" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} aria-label={t('device')}>
            {usable.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        ) : null}
      </figcaption>
    </figure>
  );
}
