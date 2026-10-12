import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

const RADIUS = 22; // outer corners
const NOTCH_RADIUS = 18; // the step into the notch
const BUTTON = 40;
const BUTTON_GAP = 10;
const NOTCH_PAD = 14;

/**
 * Outline of a card whose top-right corner is cut away to make room for round action buttons.
 * Clockwise from the top-left corner.
 */
function notchPath(width: number, height: number, notchWidth: number, notchHeight: number) {
  const r = Math.min(RADIUS, height / 2, width / 2);
  if (notchWidth <= 0) {
    return `M${r},0 H${width - r} A${r},${r} 0 0 1 ${width},${r} V${height - r} A${r},${r} 0 0 1 ${width - r},${height} H${r} A${r},${r} 0 0 1 0,${height - r} V${r} A${r},${r} 0 0 1 ${r},0 Z`;
  }
  const R = NOTCH_RADIUS;
  const x1 = width - notchWidth;
  return [
    `M${r},0`,
    `H${x1 - R}`,
    `A${R},${R} 0 0 1 ${x1},${R}`,
    `V${notchHeight - R}`,
    `A${R},${R} 0 0 0 ${x1 + R},${notchHeight}`,
    `H${width - r}`,
    `A${r},${r} 0 0 1 ${width},${notchHeight + r}`,
    `V${height - r}`,
    `A${r},${r} 0 0 1 ${width - r},${height}`,
    `H${r}`,
    `A${r},${r} 0 0 1 0,${height - r}`,
    `V${r}`,
    `A${r},${r} 0 0 1 ${r},0`,
    'Z',
  ].join(' ');
}

export interface NotchAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  /** Small accent dot, e.g. unread alerts. */
  badge?: boolean;
  active?: boolean;
}

interface NotchCardProps {
  eyebrow?: string;
  title?: string;
  actions?: NotchAction[];
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Position in the grid, used to stagger the entrance animation. */
  index?: number;
  /** Faint accent light in the top-left corner. */
  glow?: boolean;
  /** Warning state: tints the outline, not the whole card. */
  tone?: 'warn' | 'bad';
  /** Makes the whole card a button (e.g. to open details). */
  onClick?: () => void;
  ariaLabel?: string;
}

export function NotchCard({ eyebrow, title, actions = [], children, className, bodyClassName, index = 0, glow, tone, onClick, ariaLabel }: NotchCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const id = useId().replace(/:/g, '');

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setSize({ width: Math.round(box.width), height: Math.round(box.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const notchWidth = actions.length > 0 ? actions.length * BUTTON + (actions.length - 1) * BUTTON_GAP + NOTCH_PAD * 2 : 0;
  const notchHeight = actions.length > 0 ? BUTTON + NOTCH_PAD + 8 : 0;
  const path = size.width > 0 ? notchPath(size.width, size.height, notchWidth, notchHeight) : '';

  return (
    <motion.section
      ref={ref}
      initial={{ opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, delay: 0.05 + index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      className={cn('group/card relative isolate flex min-w-0 flex-col', onClick && 'cursor-pointer', className)}
      onClick={onClick}
      onKeyDown={onClick ? (event) => (event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget && (event.preventDefault(), onClick()) : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? ariaLabel : undefined}
    >
      {path && (
        <svg className="pointer-events-none absolute inset-0 -z-10 h-full w-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0.35" y2="1">
              <stop offset="0%" style={{ stopColor: 'rgb(var(--card-top))' }} />
              <stop offset="100%" style={{ stopColor: 'rgb(var(--card-bottom))' }} />
            </linearGradient>
            <pattern id={`grid-${id}`} width="22" height="22" patternUnits="userSpaceOnUse">
              <path d="M22 0H0V22" fill="none" style={{ stroke: 'rgb(var(--grid) / var(--grid-alpha))' }} strokeWidth="1" />
            </pattern>
            <radialGradient id={`glow-${id}`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform={`translate(0 0) scale(${Math.max(size.width * 0.7, 1)} ${Math.max(size.height * 0.9, 1)})`}>
              <stop offset="0%" style={{ stopColor: 'rgb(var(--accent) / 0.10)' }} />
              <stop offset="100%" style={{ stopColor: 'rgb(var(--accent) / 0)' }} />
            </radialGradient>
            <linearGradient id={`edge-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'rgb(var(--line) / calc(var(--edge-alpha) * 1.6))' }} />
              <stop offset="100%" style={{ stopColor: 'rgb(var(--line) / var(--edge-alpha))' }} />
            </linearGradient>
          </defs>
          <path d={path} fill={`url(#fill-${id})`} />
          <path d={path} fill={`url(#grid-${id})`} />
          {glow && <path d={path} fill={`url(#glow-${id})`} />}
          <path
            d={path}
            fill="none"
            stroke={`url(#edge-${id})`}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            className="transition-[stroke-opacity] duration-300"
          />
          {tone && (
            <path
              d={path}
              fill="none"
              style={{ stroke: tone === 'bad' ? 'rgb(var(--bad) / 0.55)' : 'rgb(var(--accent) / 0.55)' }}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            d={path}
            fill="none"
            style={{ stroke: 'rgb(var(--accent) / 0.28)' }}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            className="opacity-0 transition-opacity duration-300 group-hover/card:opacity-100"
          />
        </svg>
      )}

      {actions.length > 0 && (
        <div className="absolute right-0 top-0 flex items-center" style={{ gap: BUTTON_GAP, padding: `${NOTCH_PAD - 6}px ${NOTCH_PAD - 6}px 0 0` }}>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                action.onClick();
              }}
              aria-label={action.label}
              title={action.label}
              className={cn(
                'relative flex items-center justify-center rounded-full border text-muted transition-all duration-200 ease-out',
                'border-line/[0.08] bg-raised hover:-translate-y-0.5 hover:border-accent/40 hover:text-ink hover:shadow-[0_6px_20px_-6px_rgb(var(--accent)/0.5)]',
                'active:translate-y-0 active:scale-95',
                action.active && 'border-accent/40 text-accent',
              )}
              style={{ width: BUTTON, height: BUTTON }}
            >
              <span className="flex size-4 items-center justify-center [&>svg]:size-4">{action.icon}</span>
              {action.badge && (
                <span className="absolute right-[9px] top-[8px] size-1.5 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent))]" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      )}

      {(eyebrow || title) && (
        <header className="px-6 pt-5" style={{ paddingRight: notchWidth + 8 }}>
          {eyebrow && <p className="text-[12px] text-muted">{eyebrow}</p>}
          {title && <h2 className="mt-1 text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>}
        </header>
      )}
      <div className={cn('relative flex flex-1 flex-col px-6 pb-5', bodyClassName)}>{children}</div>
    </motion.section>
  );
}
