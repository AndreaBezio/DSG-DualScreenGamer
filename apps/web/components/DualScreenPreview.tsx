'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Media, Preview } from '@/lib/api';
import { Icon } from './Icon';

/**
 * How the mod looks on a two-screen handheld: the top screen above, the
 * second screen below, at the AYN Thor's proportions (1920x1080 over 1240x1080).
 */
export function DualScreenPreview({ previews, fallback }: { previews: Preview[]; fallback?: Media }) {
  const t = useTranslations('preview');
  const [i, setI] = useState(0);
  const slides: Preview[] = previews.length ? previews : [];
  if (!slides.length && !fallback) return null;
  const current = slides[i];
  const top = current?.top ?? fallback!;
  const bottom = current?.bottom;
  const caption = current?.caption ?? null;

  return (
    <figure className="dsp">
      <div className="dsp-device">
        <div className="dsp-screen dsp-top">
          <img src={top.url} alt={caption ?? t('top')} />
        </div>
        <div className="dsp-hinge" aria-hidden />
        <div className="dsp-screen dsp-bottom">
          {bottom ? <img src={bottom.url} alt={t('bottom')} /> : <span className="dsp-missing">{t('noBottom')}</span>}
        </div>
      </div>
      <figcaption className="dsp-caption">
        {slides.length > 1 ? (
          <button type="button" className="icon-btn" data-nav aria-label={t('prev')} onClick={() => setI((i - 1 + slides.length) % slides.length)}>
            <Icon name="back" size={16} />
          </button>
        ) : null}
        <span>
          {caption ?? (slides.length ? t('title') : t('single'))}
          {slides.length > 1 ? <span className="muted"> · {i + 1}/{slides.length}</span> : null}
        </span>
        {slides.length > 1 ? (
          <button type="button" className="icon-btn" data-nav aria-label={t('next')} onClick={() => setI((i + 1) % slides.length)}>
            <Icon name="next" size={16} />
          </button>
        ) : null}
      </figcaption>
    </figure>
  );
}
