import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CheckStatus = 'ok' | 'warn' | 'bad' | 'info';

const STATUS_META: Record<CheckStatus, { icon: typeof Info; className: string; border: string; label: string }> = {
  ok: { icon: CheckCircle2, className: 'text-ok', border: 'rgb(var(--ok) / 0.55)', label: 'in Ordnung' },
  info: { icon: Info, className: 'text-muted', border: 'rgb(var(--line) / 0.25)', label: 'Hinweis' },
  warn: { icon: AlertTriangle, className: 'text-warn', border: 'rgb(var(--warn) / 0.7)', label: 'prüfen' },
  bad: { icon: XCircle, className: 'text-bad', border: 'rgb(var(--bad) / 0.8)', label: 'kritisch' },
};

/** A titled block inside a report panel */
export function Section({ title, count, hint, children, className, index = 0 }: { title: string; count?: ReactNode; hint?: string; children: ReactNode; className?: string; index?: number }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index, 10) * 0.04, ease: [0.22, 1, 0.36, 1] }}
      className={cn('rounded-2xl border border-line/[0.07] bg-raised/25 p-4', className)}
    >
      <header className="mb-3 flex items-baseline gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {count !== undefined && <span className="rounded-full bg-line/[0.07] px-2 py-px font-mono text-[11px] text-muted">{count}</span>}
        {hint && <span className="ml-auto truncate text-[11px] text-faint">{hint}</span>}
      </header>
      {children}
    </motion.section>
  );
}

export interface Column<T> {
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
  align?: 'right';
}

/** Compact table with a header row and subtle row separators */
export function DataTable<T>({ columns, rows, empty = 'Keine Einträge.', max }: { columns: Array<Column<T>>; rows: T[]; empty?: string; max?: number }) {
  if (!rows.length) return <p className="text-[12.5px] text-muted">{empty}</p>;
  const visible = max ? rows.slice(0, max) : rows;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line/[0.08] text-left text-[10.5px] uppercase tracking-[0.08em] text-faint">
            {columns.map((column) => <th key={column.label} className={cn('pb-1.5 pr-3 font-medium last:pr-0', column.align === 'right' && 'text-right')}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, index) => (
            <tr key={index} className="border-b border-line/[0.04] last:border-0 hover:bg-hover/40">
              {columns.map((column) => <td key={column.label} className={cn('py-1.5 pr-3 align-top last:pr-0', column.align === 'right' && 'text-right tabular-nums', column.className)}>{column.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {max && rows.length > max && <p className="mt-1.5 text-[11px] text-faint">+ {rows.length - max} weitere</p>}
    </div>
  );
}

/** Label above value, for facts */
export function Fact({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className={cn('mt-0.5 truncate text-[13px]', mono && 'font-mono text-[12.5px]')}>{children ?? '–'}</dd>
    </div>
  );
}

/** One check result as a tile */
export function CheckTile({ status, label, value, detail, index = 0 }: { status: CheckStatus; label: string; value: ReactNode; detail?: string; index?: number }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, delay: 0.1 + Math.min(index, 16) * 0.03 }}
      className="flex gap-3 rounded-xl border border-line/[0.07] bg-panel/40 px-3 py-2.5"
      style={{ boxShadow: `inset 3px 0 0 ${meta.border}` }}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', meta.className)} />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] text-muted">{label}</span>
        </p>
        <p className="mt-0.5 break-words text-[13px] font-medium">{value}</p>
        {detail && <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{detail}</p>}
      </div>
    </motion.div>
  );
}

/** Small horizontal share bar */
export function ShareBar({ value, max, tone = 'accent' }: { value: number; max: number; tone?: 'accent' | 'bad' | 'ok' | 'warn' }) {
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-line/[0.07]">
      <motion.span className={cn('block h-full rounded-full', { accent: 'bg-accent', bad: 'bg-bad', ok: 'bg-ok', warn: 'bg-warn' }[tone])} initial={{ width: 0 }} animate={{ width: `${Math.max(2, (value / Math.max(1, max)) * 100)}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
    </span>
  );
}
