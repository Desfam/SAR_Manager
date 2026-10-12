import { useEffect, useId, useRef, useState } from 'react';
import { animate, motion, useInView } from 'motion/react';
import { cn } from '@/lib/utils';

const EASE = [0.22, 1, 0.36, 1] as const;

/* ---------- counting number ---------- */

export function AnimatedNumber({
  value,
  decimals = 0,
  className,
  format,
}: {
  value: number | null | undefined;
  decimals?: number;
  className?: string;
  format?: (value: number) => string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(0);

  useEffect(() => {
    const element = ref.current;
    if (!element || value === null || value === undefined || !Number.isFinite(value)) return;
    const render = (current: number) => {
      element.textContent = format ? format(current) : current.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    };
    const controls = animate(previous.current, value, { duration: 1.1, ease: EASE, onUpdate: render });
    previous.current = value;
    return () => controls.stop();
  }, [decimals, format, value]);

  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={className}>–</span>;
  return <span ref={ref} className={cn('tabular', className)}>0</span>;
}

/* ---------- smooth area line ---------- */

function smoothPath(points: Array<[number, number]>) {
  if (points.length < 2) return '';
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x0, y0] = points[Math.max(0, index - 1)];
    const [x1, y1] = points[index];
    const [x2, y2] = points[index + 1];
    const [x3, y3] = points[Math.min(points.length - 1, index + 2)];
    const tension = 0.18;
    d += ` C${x1 + (x2 - x0) * tension},${y1 + (y2 - y0) * tension} ${x2 - (x3 - x1) * tension},${y2 - (y3 - y1) * tension} ${x2},${y2}`;
  }
  return d;
}

/** A glowing accent line with a soft fade below. Values in any range; gaps (null) are dropped. */
export function AreaLine({ values, className, height = 64 }: { values: Array<number | null>; className?: string; height?: number }) {
  const id = useId().replace(/:/g, '');
  const width = 400;
  const present = values.map((value, index) => ({ value, index })).filter((point): point is { value: number; index: number } => point.value !== null);
  if (present.length < 2) {
    return (
      <div className={cn('flex items-end', className)} style={{ height }}>
        <div className="h-px w-full bg-gradient-to-r from-transparent via-line/10 to-transparent" />
      </div>
    );
  }
  const min = Math.min(...present.map((point) => point.value));
  const max = Math.max(...present.map((point) => point.value));
  const span = Math.max(max - min, 1);
  const top = 6;
  const bottom = height - 4;
  // Span the stretch that has data, so a young history doesn't crowd into one corner
  const first = present[0].index;
  const last = present[present.length - 1].index;
  const points = present.map(({ value, index }) => [
    ((index - first) / Math.max(last - first, 1)) * width,
    bottom - ((value - min) / span) * (bottom - top),
  ]) as Array<[number, number]>;
  const line = smoothPath(points);
  const area = `${line} L${points[points.length - 1][0]},${height} L${points[0][0]},${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={cn('w-full overflow-visible', className)} style={{ height }} aria-hidden="true">
      <defs>
        <linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'rgb(var(--accent) / 0.28)' }} />
          <stop offset="100%" style={{ stopColor: 'rgb(var(--accent) / 0)' }} />
        </linearGradient>
        <linearGradient id={`stroke-${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" style={{ stopColor: 'rgb(var(--accent) / 0.55)' }} />
          <stop offset="100%" style={{ stopColor: 'rgb(var(--accent-strong))' }} />
        </linearGradient>
        <filter id={`glow-${id}`} x="-5%" y="-40%" width="110%" height="180%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <motion.path d={area} fill={`url(#area-${id})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.5 }} />
      <motion.path
        d={line}
        fill="none"
        stroke={`url(#stroke-${id})`}
        strokeWidth="2.2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        filter={`url(#glow-${id})`}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.4, ease: EASE, delay: 0.2 }}
      />
    </svg>
  );
}

/* ---------- vertical pill bars ---------- */

export function PillBars({ bars, height = 70 }: { bars: Array<{ label: string; value: number; highlight?: boolean; title?: string }>; height?: number }) {
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  return (
    <div className="flex items-end justify-between gap-2">
      {bars.map((bar, index) => {
        const ratio = bar.value / max;
        return (
          <div key={`${bar.label}-${index}`} className="flex flex-1 flex-col items-center gap-2" title={bar.title}>
            <div className="relative flex w-full max-w-[22px] items-end" style={{ height }}>
              <motion.div
                className={cn(
                  'w-full rounded-full',
                  bar.highlight
                    ? 'bg-gradient-to-t from-accent to-accent-strong shadow-[0_0_18px_-2px_rgb(var(--accent)/0.6)]'
                    : 'bg-gradient-to-t from-line/[0.10] to-line/[0.16]',
                )}
                initial={{ height: 0 }}
                animate={{ height: Math.max(10, ratio * height) }}
                transition={{ duration: 0.9, ease: EASE, delay: 0.25 + index * 0.05 }}
              />
            </div>
            <span className={cn('text-[11px]', bar.highlight ? 'font-medium text-ink' : 'text-faint')}>{bar.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- ring ---------- */

export function Ring({ value, size = 132, stroke = 12, children }: { value: number | null; size?: number; stroke?: number; children?: React.ReactNode }) {
  const id = useId().replace(/:/g, '');
  const radius = (size - stroke) / 2;
  const fraction = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id={`ring-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: 'rgb(var(--accent-strong))' }} />
            <stop offset="100%" style={{ stopColor: 'rgb(var(--accent))' }} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} style={{ stroke: 'rgb(var(--line) / 0.07)' }} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#ring-${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          style={{ filter: 'drop-shadow(0 0 6px rgb(var(--accent) / 0.45))' }}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: fraction }}
          transition={{ duration: 1.3, ease: EASE, delay: 0.3 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

/* ---------- slider with hatched remainder ---------- */

export function LoadSlider({ value, ticks }: { value: number | null; ticks: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const percent = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div ref={ref}>
      <div className="relative h-[22px]">
        <div className="hatched absolute inset-x-0 top-1/2 h-[14px] -translate-y-1/2 rounded-full bg-line/[0.04]" />
        <motion.div
          className="absolute left-0 top-1/2 h-[14px] -translate-y-1/2 rounded-full bg-gradient-to-r from-accent/70 to-accent shadow-[0_0_20px_-4px_rgb(var(--accent)/0.7)]"
          initial={{ width: 0 }}
          animate={{ width: inView ? `${percent}%` : 0 }}
          transition={{ duration: 1.2, ease: EASE, delay: 0.3 }}
        />
        <motion.div
          className="absolute top-1/2 flex size-[26px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line/15 bg-raised shadow-lg"
          initial={{ left: '0%' }}
          animate={{ left: inView ? `${percent}%` : '0%' }}
          transition={{ duration: 1.2, ease: EASE, delay: 0.3 }}
          aria-hidden="true"
        >
          <span className="flex flex-col gap-[2px]">
            <span className="size-[3px] rounded-full bg-ink" />
            <span className="size-[3px] rounded-full bg-ink" />
            <span className="size-[3px] rounded-full bg-ink" />
          </span>
        </motion.div>
      </div>
      <div className="mt-3 flex justify-between text-[11px] text-faint">
        {ticks.map((tick) => <span key={tick}>{tick}</span>)}
      </div>
    </div>
  );
}

/* ---------- glass orb ---------- */

/** A slowly turning glass shape lit from below in the accent colour. Pure CSS, decorative. */
export function Orb({ size = 150, className }: { size?: number; className?: string }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{ width: size, height: size }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-hidden="true"
    >
      <div className="absolute inset-[18%] rounded-full bg-accent/25 blur-3xl" />
      <motion.div
        className="absolute inset-[8%]"
        animate={{ rotate: 360 }}
        transition={{ duration: hover ? 9 : 22, repeat: Infinity, ease: 'linear' }}
      >
        <div
          className="absolute inset-0 rounded-[46%_54%_42%_58%/52%_44%_56%_48%]"
          style={{
            background:
              'radial-gradient(120% 90% at 30% 20%, rgb(255 255 255 / 0.20), transparent 45%), radial-gradient(80% 60% at 70% 90%, rgb(var(--accent-strong) / 0.95), transparent 60%), radial-gradient(100% 100% at 50% 50%, rgb(40 40 44 / 0.9), rgb(12 12 13 / 0.95))',
            boxShadow: 'inset 0 0 0 1.5px rgb(255 255 255 / 0.14), inset 0 -18px 30px -10px rgb(var(--accent) / 0.85), inset 0 10px 24px -12px rgb(255 255 255 / 0.25)',
          }}
        />
        <div
          className="absolute inset-[22%] rounded-[50%_44%_56%_46%/46%_56%_44%_54%]"
          style={{
            background: 'radial-gradient(90% 80% at 40% 35%, rgb(8 8 9), rgb(18 18 20))',
            boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.10), 0 0 22px -4px rgb(var(--accent) / 0.65), inset 0 -8px 16px -8px rgb(var(--accent-strong) / 0.9)',
          }}
        />
      </motion.div>
    </div>
  );
}

/* ---------- trend ---------- */

export function Trend({ value, suffix = '', goodWhenUp = true }: { value: number | null; suffix?: string; goodWhenUp?: boolean }) {
  if (value === null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  const good = up === goodWhenUp;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[12.5px] font-medium', good ? 'text-accent' : 'text-bad')}>
      <span aria-hidden="true">{up ? '↗' : '↘'}</span>
      {Math.abs(value).toLocaleString('de-DE', { maximumFractionDigits: 1 })}
      {suffix}
    </span>
  );
}
