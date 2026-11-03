'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Display, Preview } from '@/lib/api';
import { frameStyle, THOR } from '@/lib/frame';
import { Icon } from './Icon';

export type PreviewDevice = { id: string; name: string; displays: Display[] };

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
