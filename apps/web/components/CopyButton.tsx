'use client';

import { useState } from 'react';
import { Icon } from './Icon';

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn"
      data-nav
      aria-label={label}
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // Clipboard unavailable (insecure context): leave the text selectable
        }
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={16} />
    </button>
  );
}
