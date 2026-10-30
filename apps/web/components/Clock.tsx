'use client';

import { useEffect, useState } from 'react';

/** Status-bar clock. Rendered after mount so server and client markup agree. */
export function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <time className="clock" suppressHydrationWarning>
      {now ? now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
    </time>
  );
}
