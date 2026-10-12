import { useState } from 'react';
import { motion } from 'motion/react';
import { Cpu, HardDrive, Loader2, MemoryStick } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Thresholds } from '@/services/alerting';

const METRICS = [
  { key: 'cpu', label: 'CPU', icon: Cpu },
  { key: 'memory', label: 'Arbeitsspeicher', icon: MemoryStick },
  { key: 'disk', label: 'Festplatte', icon: HardDrive },
] as const;

function NumberField({ value, onChange, tone }: { value: number; onChange: (value: number) => void; tone: 'warn' | 'bad' }) {
  return (
    <label className={cn('flex h-8 items-center gap-1 rounded-full border bg-raised/50 px-2.5', tone === 'warn' ? 'border-warn/35' : 'border-bad/35')}>
      <input type="number" min={1} max={100} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-9 bg-transparent text-right font-mono text-[12.5px] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
      <span className="text-[11px] text-muted">%</span>
    </label>
  );
}

/** Warning / critical per metric, with a zone bar that shows the effect */
export function ThresholdEditor({ value, onSave, saving, actions }: { value: Thresholds; onSave: (value: Thresholds) => void; saving?: boolean; actions?: React.ReactNode }) {
  const [draft, setDraft] = useState(value);
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  const invalid = METRICS.some(({ key }) => draft[`${key}Warning`] >= draft[`${key}Critical`]);
  return (
    <div className="space-y-4">
      {METRICS.map(({ key, label, icon: Icon }, index) => {
        const warning = draft[`${key}Warning`];
        const critical = draft[`${key}Critical`];
        const wrong = warning >= critical;
        return (
          <div key={key}>
            <div className="mb-1.5 flex items-center gap-2.5">
              <Icon className="size-4 text-muted" />
              <span className="flex-1 text-[13px] font-medium">{label}</span>
              <span className="text-[11px] text-faint">Warnung ab</span>
              <NumberField value={warning} tone="warn" onChange={(next) => setDraft({ ...draft, [`${key}Warning`]: next })} />
              <span className="text-[11px] text-faint">kritisch ab</span>
              <NumberField value={critical} tone="bad" onChange={(next) => setDraft({ ...draft, [`${key}Critical`]: next })} />
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-line/[0.07]">
              <motion.span className="absolute inset-y-0 left-0 bg-ok/45" animate={{ width: `${Math.min(warning, 100)}%` }} transition={{ duration: 0.5, delay: index * 0.05 }} />
              <motion.span className="absolute inset-y-0 bg-warn/60" animate={{ left: `${Math.min(warning, 100)}%`, width: `${Math.max(0, Math.min(critical, 100) - Math.min(warning, 100))}%` }} transition={{ duration: 0.5, delay: index * 0.05 }} />
              <motion.span className="absolute inset-y-0 right-0 bg-bad/70" animate={{ left: `${Math.min(critical, 100)}%` }} transition={{ duration: 0.5, delay: index * 0.05 }} />
            </div>
            {wrong && <p className="mt-1 text-[11px] text-bad">Warnung muss unter Kritisch liegen.</p>}
          </div>
        );
      })}
      <div className="flex items-center gap-2 pt-1">
        {actions}
        <button type="button" disabled={!dirty || invalid || saving} onClick={() => onSave(draft)} className="ml-auto flex h-9 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-4 text-[12.5px] font-medium text-accent-ink disabled:opacity-40">
          {saving && <Loader2 className="size-3.5 animate-spin" />} Speichern
        </button>
      </div>
    </div>
  );
}
