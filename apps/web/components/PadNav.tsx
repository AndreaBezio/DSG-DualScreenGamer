'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

type Dir = 'up' | 'down' | 'left' | 'right';

function navigables(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-nav]')].filter((el) => el.offsetParent !== null);
}

/** Moves focus to the nearest [data-nav] element in a direction (spatial navigation). */
function move(dir: Dir) {
  const items = navigables();
  const current = document.activeElement as HTMLElement | null;
  if (!current || !items.includes(current)) {
    items[0]?.focus();
    return;
  }
  const a = current.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of items) {
    if (el === current) continue;
    const b = el.getBoundingClientRect();
    const dx = b.left + b.width / 2 - ax;
    const dy = b.top + b.height / 2 - ay;
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 1) continue;
    const score = along + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    best.focus();
    best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

const KEYS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
// Standard gamepad mapping: 12-15 = d-pad, 0 = A (south), 1 = B (east)
const PAD: Record<number, Dir> = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

/** Arrow keys and gamepads drive the UI, so the site works from a handheld's browser. */
export function PadNav() {
  const router = useRouter();

  useEffect(() => {
    const back = () => {
      const link = document.querySelector<HTMLAnchorElement>('[data-back]');
      if (link) link.click();
      else router.back();
    };

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      if (typing && e.key !== 'ArrowDown' && e.key !== 'Escape') return;
      const dir = KEYS[e.key];
      if (dir) {
        e.preventDefault();
        move(dir);
      } else if (e.key === 'Escape' || (e.key === 'Backspace' && !typing)) {
        e.preventDefault();
        if (typing) target.blur();
        else back();
      }
    };
    window.addEventListener('keydown', onKey);

    let raf = 0;
    let held = new Set<number>();
    let repeatAt = 0;
    const poll = () => {
      const pad = navigator.getGamepads?.().find(Boolean);
      if (pad) {
        const now = performance.now();
        const pressed = new Set<number>();
        pad.buttons.forEach((b, i) => b.pressed && pressed.add(i));
        // Left stick acts as a d-pad
        const [x = 0, y = 0] = pad.axes;
        if (y < -0.6) pressed.add(12);
        if (y > 0.6) pressed.add(13);
        if (x < -0.6) pressed.add(14);
        if (x > 0.6) pressed.add(15);
        for (const i of pressed) {
          const fresh = !held.has(i);
          if (PAD[i] && (fresh || now > repeatAt)) {
            move(PAD[i]!);
            repeatAt = now + (fresh ? 380 : 120);
          } else if (fresh && i === 0) (document.activeElement as HTMLElement | null)?.click();
          else if (fresh && i === 1) back();
        }
        held = pressed;
      }
      raf = requestAnimationFrame(poll);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(poll);
      document.documentElement.dataset.pad = 'on';
    };
    window.addEventListener('gamepadconnected', start);
    if (navigator.getGamepads?.().some(Boolean)) start();

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('gamepadconnected', start);
      cancelAnimationFrame(raf);
    };
  }, [router]);

  return null;
}
