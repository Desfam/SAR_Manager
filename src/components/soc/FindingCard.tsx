import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronDown, FileSearch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SEVERITY_STYLE, formatTime } from '@/lib/soc';
import type { Finding, Severity } from '@/services/soc';

export function SeverityBadge({ severity }: { severity: Severity }) {
  const style = SEVERITY_STYLE[severity];
  return <span className={cn('inline-flex whitespace-nowrap rounded-full border px-2 py-px text-[10.5px]', style.className)}>{style.label}</span>;
}

type FindingLike = Omit<Finding, 'id' | 'status' | 'createdAt' | 'updatedAt'> & Partial<Pick<Finding, 'id' | 'status'>>;

/** Expandable finding: reason, evidence, checks, link to the matching events */
export function FindingCard({ finding, index = 0, leading, trailing, showHost }: { finding: FindingLike; index?: number; leading?: React.ReactNode; trailing?: React.ReactNode; showHost?: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.03 }}
      className="overflow-hidden rounded-2xl border border-line/[0.08] bg-raised/30"
      style={{ boxShadow: `inset 3px 0 0 ${SEVERITY_STYLE[finding.severity].color}` }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {leading}
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <SeverityBadge severity={finding.severity} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{finding.title}</span>
            {!open && <span className="block truncate text-[12px] text-muted">{finding.reason}</span>}
            <span className="block truncate text-[11px] text-faint">
              {showHost && <>{finding.host} · </>}{finding.category}
              {finding.eventCount ? ` · ${finding.eventCount} Events` : ''}
              {finding.lastSeen ? ` · zuletzt ${formatTime(finding.lastSeen, true)}` : ''}
            </span>
          </span>
          <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
        </button>
        {trailing}
      </div>
      {open && (
        <div className="space-y-3 border-t border-line/[0.06] px-4 pb-4 pt-3 text-[12.5px]">
          <p className="leading-relaxed text-ink/85">{finding.reason}</p>
          {!!finding.evidence.length && (
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Belege</p>
              <ul className="space-y-0.5 font-mono text-[11.5px]">{finding.evidence.map((entry) => <li key={entry} className="break-all">{entry}</li>)}</ul>
            </div>
          )}
          {!!finding.checks.length && (
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Prüfen</p>
              <ul className="list-disc space-y-0.5 pl-5">{finding.checks.map((entry) => <li key={entry}>{entry}</li>)}</ul>
            </div>
          )}
          {finding.query && (
            <button type="button" onClick={() => navigate(`/wazuh/investigation?q=${encodeURIComponent(finding.query!)}`)} className="flex h-8 items-center gap-2 rounded-full border border-line/[0.12] px-3 text-[12px] text-muted hover:text-ink">
              <FileSearch className="size-3.5" /> Events ansehen
            </button>
          )}
        </div>
      )}
    </motion.li>
  );
}
