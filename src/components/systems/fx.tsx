// Animated building blocks for the server overview
import { useId, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { AnimatedNumber } from '@/components/ui/viz';
import { staggerParent, TONE_COLOR, toneFor, type Tone } from '@/lib/fx';

const EASE = [0.22, 1, 0.36, 1] as const;


/* ---------- stagger reveal ---------- */


export function Stagger({ children, className, as = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'ul' | 'dl' }) {
  const Tag = as === 'ul' ? motion.ul : as === 'dl' ? motion.dl : motion.div;
  return (
    <Tag className={className} variants={staggerParent} initial="hidden" animate="show">
      {children}
    </Tag>
  );
}

/* ---------- radial gauge ---------- */

/** 270° gauge with a glowing arc, ticks and a counting value */
export function Gauge({ value, label, sub, size = 132 }: { value: number | null; label: string; sub?: ReactNode; size?: number }) {
  const id = useId().replace(/:/g, '');
  const stroke = 10;
  const radius = (size - stroke) / 2 - 4;
  const sweep = 270;
  const fraction = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  const color = TONE_COLOR[toneFor(value)];
  const polar = (angle: number, r = radius) => {
    const rad = ((angle - 225) * Math.PI) / 180; // start bottom-left
    return [size / 2 + r * Math.cos(rad), size / 2 + r * Math.sin(rad)];
  };
  const [sx, sy] = polar(0);
  const [ex, ey] = polar(sweep);
  const arc = `M${sx},${sy} A${radius},${radius} 0 1 1 ${ex},${ey}`;
  const [nx, ny] = polar(sweep * fraction, radius);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={`g-${id}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.55 }} />
            <stop offset="100%" style={{ stopColor: color }} />
          </linearGradient>
        </defs>
        {Array.from({ length: 28 }, (_, index) => {
          const angle = (sweep / 27) * index;
          const [x1, y1] = polar(angle, radius + 9);
          const [x2, y2] = polar(angle, radius + (index % 9 === 0 ? 13 : 11));
          const lit = index / 27 <= fraction;
          return <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={1.2} strokeLinecap="round" style={{ stroke: lit ? color : 'rgb(var(--line) / 0.12)', transition: 'stroke 0.6s' }} />;
        })}
        <path d={arc} fill="none" strokeWidth={stroke} strokeLinecap="round" style={{ stroke: 'rgb(var(--line) / 0.07)' }} />
        <motion.path
          d={arc}
          fill="none"
          stroke={`url(#g-${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 8px ${color})` }}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: fraction }}
          transition={{ duration: 1.4, ease: EASE }}
        />
        {value !== null && (
          <motion.circle
            r={4.5}
            style={{ fill: 'rgb(var(--ink))', filter: `drop-shadow(0 0 6px ${color})` }}
            initial={{ cx: sx, cy: sy }}
            animate={{ cx: nx, cy: ny }}
            transition={{ duration: 1.4, ease: EASE }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
        <span className="text-[26px] font-bold leading-none tracking-[-0.03em]" style={{ color: value !== null && value >= 80 ? color : undefined }}>
          <AnimatedNumber value={value === null ? null : Math.round(value)} />
          {value !== null && <span className="ml-0.5 text-[13px] font-medium text-muted">%</span>}
        </span>
        <span className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted">{label}</span>
        {sub && <span className="mt-0.5 font-mono text-[10px] text-faint">{sub}</span>}
      </div>
    </div>
  );
}

/* ---------- live sparkline ---------- */


export function LiveSpark({ values, max = 100, height = 46, color = 'rgb(var(--accent))' }: { values: number[]; max?: number; height?: number; color?: string }) {
  const id = useId().replace(/:/g, '');
  const width = 300;
  const slots = 48;
  if (values.length < 2) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-faint" style={{ height }}>
        <motion.span className="size-1.5 rounded-full bg-accent" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.4, repeat: Infinity }} />
        sammle Live-Werte …
      </div>
    );
  }
  const step = width / (slots - 1);
  const offset = (slots - values.length) * step;
  const points = values.map((value, index) => [offset + index * step, height - 3 - (Math.min(value, max) / max) * (height - 8)] as const);
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${points[points.length - 1][0]},${height} L${points[0][0]},${height} Z`;
  const [lx, ly] = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full overflow-visible" style={{ height }} aria-hidden="true">
      <defs>
        <linearGradient id={`s-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.35 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <motion.path d={area} fill={`url(#s-${id})`} animate={{ d: area }} transition={{ duration: 0.6, ease: EASE }} />
      <motion.path d={line} fill="none" stroke={color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" animate={{ d: line }} transition={{ duration: 0.6, ease: EASE }} />
      <motion.circle r={3} style={{ fill: color }} animate={{ cx: lx, cy: ly }} transition={{ duration: 0.6, ease: EASE }} />
      <motion.circle r={3} style={{ fill: 'none', stroke: color }} strokeWidth={1.5} animate={{ cx: lx, cy: ly, r: [3, 10], opacity: [0.8, 0] }} transition={{ cx: { duration: 0.6 }, cy: { duration: 0.6 }, r: { duration: 1.6, repeat: Infinity }, opacity: { duration: 1.6, repeat: Infinity } }} />
    </svg>
  );
}

/* ---------- status beacon ---------- */

export function Beacon({ tone, size = 10 }: { tone: 'ok' | 'bad' | 'muted' | 'warn'; size?: number }) {
  const color = tone === 'ok' ? 'rgb(var(--ok))' : tone === 'bad' ? 'rgb(var(--bad))' : tone === 'warn' ? 'rgb(var(--accent))' : 'rgb(var(--faint))';
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {tone !== 'muted' &&
        [0, 0.8].map((delay) => (
          <motion.span
            key={delay}
            className="absolute inset-0 rounded-full"
            style={{ background: color }}
            initial={{ scale: 1, opacity: 0.6 }}
            animate={{ scale: 3, opacity: 0 }}
            transition={{ duration: 1.6, repeat: Infinity, delay, ease: 'easeOut' }}
          />
        ))}
      <span className="relative inline-flex rounded-full" style={{ width: size, height: size, background: color, boxShadow: `0 0 10px ${color}` }} />
    </span>
  );
}

/* ---------- radar (Wazuh connected) ---------- */

export function Radar({ active, size = 64, children }: { active: boolean; size?: number; children?: ReactNode }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full border border-line/[0.10]" />
      <div className="absolute inset-[22%] rounded-full border border-line/[0.08]" />
      {active && (
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{ background: 'conic-gradient(from 0deg, rgb(var(--ok) / 0.0) 0deg, rgb(var(--ok) / 0.0) 270deg, rgb(var(--ok) / 0.45) 360deg)' }}
          animate={{ rotate: 360 }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'linear' }}
        />
      )}
      {active && (
        <motion.div className="absolute inset-0 rounded-full border border-ok/40" animate={{ scale: [1, 1.35], opacity: [0.6, 0] }} transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut' }} />
      )}
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

/* ---------- animated fill bar ---------- */

export function FillBar({ value, tone, delay = 0, height = 6 }: { value: number | null; tone?: Tone; delay?: number; height?: number }) {
  const resolved = tone ?? toneFor(value);
  const color = TONE_COLOR[resolved];
  return (
    <div className="relative overflow-hidden rounded-full bg-line/[0.07]" style={{ height }}>
      <motion.div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${color} 60%, transparent), ${color})`, boxShadow: `0 0 12px -2px ${color}` }}
        initial={{ width: 0 }}
        animate={{ width: `${value === null ? 0 : Math.max(2, Math.min(100, value))}%` }}
        transition={{ duration: 1.1, ease: EASE, delay }}
      />
      {value !== null && value > 0 && (
        <motion.div
          className="absolute inset-y-0 w-10 bg-gradient-to-r from-transparent via-white/25 to-transparent"
          initial={{ left: '-15%' }}
          animate={{ left: '115%' }}
          transition={{ duration: 1.8, delay: delay + 1.2, repeat: Infinity, repeatDelay: 4, ease: 'easeInOut' }}
        />
      )}
    </div>
  );
}

/* ---------- scan overlay while SSH data loads ---------- */

export function ScanOverlay({ active, label = 'Lese per SSH …' }: { active: boolean; label?: string }) {
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-[22px]">
      <motion.div
        className="absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-accent/[0.10] to-transparent"
        initial={{ top: '-20%' }}
        animate={{ top: '110%' }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      />
      <span className="absolute bottom-3 right-4 flex items-center gap-1.5 text-[11px] text-accent">
        <motion.span className="size-1.5 rounded-full bg-accent" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1, repeat: Infinity }} /> {label}
      </span>
    </div>
  );
}

/* ---------- skeleton line ---------- */

export function Shimmer({ className }: { className?: string }) {
  return (
    <span className={cn('relative block overflow-hidden rounded-md bg-line/[0.06]', className)}>
      <motion.span className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-line/[0.10] to-transparent" initial={{ left: '-50%' }} animate={{ left: '120%' }} transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }} />
    </span>
  );
}

/* ---------- split bar (security vs. other updates) ---------- */

export function SplitBar({ parts, height = 8 }: { parts: Array<{ value: number; color: string; label: string }>; height?: number }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;
  return (
    <div className="flex gap-0.5 overflow-hidden rounded-full bg-line/[0.07]" style={{ height }}>
      {parts.map((part, index) => (
        <motion.span
          key={part.label}
          title={`${part.label}: ${part.value}`}
          className="h-full first:rounded-l-full last:rounded-r-full"
          style={{ background: part.color, boxShadow: `0 0 10px -2px ${part.color}` }}
          initial={{ width: 0 }}
          animate={{ width: `${(part.value / total) * 100}%` }}
          transition={{ duration: 1, ease: EASE, delay: 0.3 + index * 0.15 }}
        />
      ))}
    </div>
  );
}
