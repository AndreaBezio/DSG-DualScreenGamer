'use client';

import type { ReactNode } from 'react';

/** A download link that also tells the API an install happened (anonymous, once a day per visitor). */
export function DownloadButton({ href, apiUrl, modId, version, children }: { href: string; apiUrl: string; modId: string; version?: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="btn btn-primary"
      data-nav
      rel="noopener"
      onClick={() => {
        try {
          navigator.sendBeacon(`${apiUrl.replace(/\/$/, '')}/v1/mods/${encodeURIComponent(modId)}/installs`, JSON.stringify({ version }));
        } catch {
          // Counting is best effort
        }
      }}
    >
      {children}
    </a>
  );
}
