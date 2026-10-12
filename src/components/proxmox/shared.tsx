import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Timeframe } from '@/services/proxmox';
import { POWER, type PowerAction } from './power';
import { toneBar, toneText, usageTone, type UsageTone } from '@/lib/usage';

export function Meter({ value, className }: { value: number | null; className?: string }) {
  const percent = value === null ? 0 : Math.min(100, Math.max(0, value));

  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-line/[0.07]', className)}>
      <motion.div
        className={cn('h-full rounded-full bg-gradient-to-r', toneBar[usageTone(value)])}
        initial={false}
        animate={{ width: `${percent}%` }}
        // Keep tiny values visible: anything above 0 gets at least a sliver
        style={{ minWidth: percent > 0 ? 4 : 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}

/** Percentage next to a meter; the number carries the information when the bar is tiny. */
export function UsageValue({ value, className }: { value: number | null; className?: string }) {
  return (
    <span className={cn('font-mono text-[12px] font-semibold tabular', value === null ? 'text-faint' : toneText[usageTone(value)], className)}>
      {value === null ? '–' : `${value < 10 && value > 0 ? value.toFixed(1).replace('.', ',') : Math.round(value)} %`}
    </span>
  );
}

export function ActionButton({
  action,
  onClick,
  enabled,
  busy,
  size = 'sm',
}: {
  action: PowerAction;
  onClick: () => void;
  enabled: boolean;
  busy?: boolean;
  size?: 'sm' | 'md';
}) {
  const Icon = POWER[action].icon;
  const danger = action === 'stop';
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={!enabled}
      aria-label={POWER[action].label}
      title={POWER[action].label}
      className={cn(
        'flex items-center justify-center rounded-full border border-line/[0.09] bg-raised/60 text-muted transition-all duration-150',
        size === 'sm' ? 'size-8' : 'size-10',
        'enabled:hover:-translate-y-px enabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-25',
        danger ? 'enabled:hover:border-bad/50 enabled:hover:text-bad' : 'enabled:hover:border-accent/40 enabled:hover:text-accent',
      )}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  id,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; count?: number }>;
  id: string;
}) {
  return (
    <div className="flex rounded-full border border-line/[0.10] bg-raised/50 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn('relative h-8 rounded-full px-3.5 text-[12.5px] transition-colors', value === option.value ? 'text-ink' : 'text-muted hover:text-ink')}
        >
          {value === option.value && (
            <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-full border border-accent/25 bg-accent/[0.12]" transition={{ type: 'spring', stiffness: 450, damping: 38 }} />
          )}
          <span className="relative">
            {option.label}
            {option.count !== undefined && <span className="ml-1.5 font-mono text-[11px] text-faint">{option.count}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

export function TimeframeSwitch({ value, onChange, id }: { value: Timeframe; onChange: (value: Timeframe) => void; id: string }) {
  return (
    <Segmented<Timeframe>
      id={id}
      value={value}
      onChange={onChange}
      options={[
        { value: 'hour', label: '1 h' },
        { value: 'day', label: '24 h' },
        { value: 'week', label: '7 T' },
        { value: 'month', label: '1 M' },
        { value: 'year', label: '1 J' },
      ]}
    />
  );
}

export function StatTile({ label, value, sub, tone = 'normal' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: UsageTone }) {
  return (
    <div
      className={cn(
        'rounded-2xl border bg-raised/40 p-3.5',
        tone === 'bad' ? 'border-bad/35' : tone === 'warn' ? 'border-accent/40' : 'border-line/[0.07]',
      )}
    >
      <p className="text-[11.5px] text-muted">{label}</p>
      <p className={cn('mt-1 text-[20px] font-semibold leading-tight tabular', toneText[tone])}>{value}</p>
      {sub && <div className="mt-1 text-[11.5px] text-muted">{sub}</div>}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 mt-7 flex items-center justify-between gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">{children}</h3>
      {aside}
    </div>
  );
}

export function GuestStatusLabel({ status, pending }: { status?: string; pending?: string }) {
  if (pending) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-accent">
        <Loader2 className="size-3 animate-spin" /> {pending}
      </span>
    );
  }
  const running = status === 'running';
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12px]', running ? 'text-ok' : status === 'paused' ? 'text-warn' : 'text-muted')}>
      <span className="relative flex size-2">
        {running && <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok/40 [animation-duration:2.4s]" />}
        <span className={cn('relative size-2 rounded-full', running ? 'bg-ok' : status === 'paused' ? 'bg-warn' : 'bg-faint')} />
      </span>
      {running ? 'Running' : status === 'paused' ? 'Paused' : 'Stopped'}
    </span>
  );
}
