import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { Check, ChevronRight, CircleHelp, Copy, TriangleAlert, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Finding, Status } from '@/services/hardening';
import { SEVERITY_LABEL, SEVERITY_RANK, STATUS_STYLE } from '@/lib/hardening';

const STATUS_ICON: Record<Status, typeof Check> = { pass: Check, warn: TriangleAlert, fail: XCircle, unknown: CircleHelp };

function CommandBlock({ command }: { command: string }) {
  return (
    <div className="group relative">
      <pre className="scroll-thin overflow-x-auto whitespace-pre rounded-xl bg-canvas py-2.5 pl-3 pr-10 font-mono text-[11.5px] leading-[18px] text-ink/90">{command}</pre>
      <button
        type="button"
        aria-label="Befehl kopieren"
        onClick={() => void navigator.clipboard.writeText(command).then(() => toast.success('Befehl kopiert'))}
        className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-lg text-muted opacity-60 transition-opacity hover:bg-raised hover:text-ink group-hover:opacity-100"
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}

export function FindingRow({ finding, defaultOpen = false }: { finding: Finding; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const style = STATUS_STYLE[finding.status];
  const Icon = STATUS_ICON[finding.status];
  const expandable = !!(finding.fix || finding.commands?.length);
  return (
    <li className={cn('rounded-2xl border transition-colors', open ? 'border-line/[0.12] bg-raised/30' : 'border-line/[0.06]')}>
      <button type="button" onClick={() => expandable && setOpen(!open)} className={cn('flex w-full items-start gap-3 px-3.5 py-3 text-left', !expandable && 'cursor-default')}>
        <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border', style.cell)}>
          <Icon className="size-3" strokeWidth={2.5} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[13px] font-medium">{finding.title}</span>
            {finding.status !== 'pass' && finding.status !== 'unknown' && (
              <span className={cn('rounded-full px-1.5 py-px text-[10.5px]', SEVERITY_RANK[finding.severity] >= 3 ? 'bg-bad/10 text-bad' : 'bg-line/[0.06] text-muted')}>{SEVERITY_LABEL[finding.severity]}</span>
            )}
          </span>
          <span className="mt-0.5 block text-[12px] leading-[18px] text-muted">{finding.detail}</span>
        </span>
        {expandable && <ChevronRight className={cn('mt-1 size-4 shrink-0 text-faint transition-transform', open && 'rotate-90')} />}
      </button>
      <AnimatePresence initial={false}>
        {open && expandable && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="space-y-2 px-3.5 pb-3.5 pl-11">
              {finding.fix && <p className="text-[12.5px] leading-[19px] text-ink/90">{finding.fix}</p>}
              {finding.commands?.map((command) => <CommandBlock key={command} command={command} />)}
              {finding.commands?.length ? <p className="text-[11px] text-faint">Beispiele: an das System anpassen, Platzhalter in &lt;…&gt; ersetzen und schrittweise prüfen.</p> : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

/** Problems first (by severity), passed checks collapsed at the end */
export function FindingList({ findings }: { findings: Finding[] }) {
  const [showPassed, setShowPassed] = useState(false);
  const order: Record<Status, number> = { fail: 0, warn: 1, unknown: 2, pass: 3 };
  const sorted = [...findings].sort((a, b) => order[a.status] - order[b.status] || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const problems = sorted.filter((finding) => finding.status !== 'pass');
  const passed = sorted.filter((finding) => finding.status === 'pass');
  return (
    <div className="space-y-1.5">
      <ul className="space-y-1.5">{problems.map((finding) => <FindingRow key={finding.id} finding={finding} />)}</ul>
      {passed.length > 0 && (
        <>
          <button type="button" onClick={() => setShowPassed(!showPassed)} className="flex items-center gap-1.5 px-1 py-1 text-[12px] text-muted hover:text-ink">
            <ChevronRight className={cn('size-3.5 transition-transform', showPassed && 'rotate-90')} /> {passed.length} erfüllt
          </button>
          {showPassed && <ul className="space-y-1.5">{passed.map((finding) => <FindingRow key={finding.id} finding={finding} />)}</ul>}
        </>
      )}
    </div>
  );
}
