// Shared animation settings and tone colours for the animated overview components
import { useEffect, useRef, useState } from 'react';
import type { Variants } from 'motion/react';

export const EASE = [0.22, 1, 0.36, 1] as const;

export type Tone = 'normal' | 'warn' | 'bad' | 'ok' | 'muted';

export const TONE_COLOR: Record<Tone, string> = {
  normal: 'rgb(var(--accent))',
  warn: 'rgb(var(--accent))',
  bad: 'rgb(var(--bad))',
  ok: 'rgb(var(--ok))',
  muted: 'rgb(var(--faint))',
};

export const toneFor = (value: number | null): Tone => (value === null ? 'muted' : value >= 90 ? 'bad' : value >= 80 ? 'warn' : 'normal');

export const staggerParent: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.045, delayChildren: 0.1 } } };
export const staggerChild: Variants = { hidden: { opacity: 0, y: 8, filter: 'blur(4px)' }, show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.45, ease: EASE } } };

/** Keeps the last `size` values of a polled number, so a chart can grow live */
export function useLiveSeries(value: number | null, size = 48) {
  const [series, setSeries] = useState<number[]>([]);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (value === null || value === last.current) return;
    last.current = value;
    setSeries((current) => [...current, value].slice(-size));
  }, [value, size]);
  return series;
}
