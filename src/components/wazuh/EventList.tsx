import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { ChevronRight, Copy, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Drawer } from '@/components/ui/Drawer';
import { wazuhApi, type WazuhEvent } from '@/services/wazuh';
import { SEVERITY, severityOf, type AgentMatch } from '@/lib/wazuh';

const time = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export function LevelPill({ level }: { level: number }) {
  const severity = SEVERITY[severityOf(level)];
  return <span className={cn('inline-flex min-w-[34px] justify-center rounded-full border px-1.5 py-px font-mono text-[11px]', severity.pill)} title={`${severity.label} (Level ${level})`}>{level}</span>;
}

function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  if (children === undefined || children === null || children === '') return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-[12px] text-muted">{label}</dt>
      <dd className={cn('min-w-0 break-words text-right text-[12.5px]', mono && 'font-mono text-[12px]')}>{children}</dd>
    </div>
  );
}

function EventDetail({ event, match, onOpenSystem }: { event: WazuhEvent; match?: AgentMatch; onOpenSystem?: (id: string) => void }) {
  const detail = useQuery({ queryKey: ['infra', 'wazuh', 'event', event.index, event.id], queryFn: () => wazuhApi.event(event.index, event.id) });
  const severity = SEVERITY[severityOf(event.rule.level)];
  const raw = detail.data ? JSON.stringify(detail.data.raw, null, 2) : '';
  return (
    <div className="px-7 pb-8 pt-7">
      <p className="flex items-center gap-2 text-[12px] text-muted"><LevelPill level={event.rule.level} /> {severity.label} · Regel {event.rule.id} · {time(event.timestamp)}</p>
      <h2 className="mt-2 pr-12 text-[20px] font-semibold leading-snug tracking-[-0.01em]">{event.rule.description}</h2>

      <dl className="mt-4 divide-y divide-line/[0.05] rounded-2xl border border-line/[0.07] px-4 py-1">
        <Field label="Agent" mono>{event.agent.name} {event.agent.ip ? `· ${event.agent.ip}` : ''} {event.agent.id ? `· ID ${event.agent.id}` : ''}</Field>
        {match?.connection || match?.guest ? (
          <Field label="System">
            {match.connection ? (
              <button type="button" onClick={() => onOpenSystem?.(match.connection!.id)} className="text-accent hover:underline">{match.connection.name}</button>
            ) : null}
            {match.guest ? <span className="ml-2 text-muted">{match.guest.type === 'lxc' ? 'CT' : 'VM'} {match.guest.vmid} · {match.guest.node}</span> : null}
          </Field>
        ) : null}
        <Field label="Schwachstelle" mono>{event.vulnerability ? `${event.vulnerability.cve}${event.vulnerability.severity ? ` · ${event.vulnerability.severity}` : ''}` : undefined}</Field>
        <Field label="Paket" mono>{event.vulnerability?.package ? `${event.vulnerability.package} ${event.vulnerability.version ?? ''}` : undefined}</Field>
        <Field label="Behoben ab">{event.vulnerability?.condition}</Field>
        <Field label="Gruppen">{event.rule.groups.join(', ')}</Field>
        <Field label="MITRE">{[...event.rule.mitre.ids, ...event.rule.mitre.tactics].join(' · ')}</Field>
        <Field label="Quelle (IP)" mono>{event.sourceIp}</Field>
        <Field label="Benutzer" mono>{[event.sourceUser, event.destinationUser].filter(Boolean).join(' → ')}</Field>
        <Field label="Windows-Event" mono>{event.windows ? `${event.windows.eventId}${event.windows.channel ? ` · ${event.windows.channel}` : ''}` : undefined}</Field>
        <Field label="Decoder" mono>{event.decoder}</Field>
        <Field label="Ort" mono>{event.location}</Field>
        <Field label="Wie oft (Regel)">{event.rule.firedtimes}</Field>
      </dl>

      {event.fullLog && (
        <>
          <p className="mb-1.5 mt-5 text-[12px] font-medium text-muted">Log-Zeile</p>
          <pre className="scroll-thin max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-2xl bg-canvas p-3 font-mono text-[11.5px] leading-[18px] text-ink/90">{event.fullLog}</pre>
        </>
      )}

      <div className="mb-1.5 mt-5 flex items-center justify-between">
        <p className="text-[12px] font-medium text-muted">Rohdaten</p>
        {raw && (
          <button type="button" onClick={() => void navigator.clipboard.writeText(raw).then(() => toast.success('Event kopiert'))} className="flex h-7 items-center gap-1.5 rounded-full border border-line/[0.12] px-2.5 text-[11.5px] hover:bg-raised">
            <Copy className="size-3" /> Kopieren
          </button>
        )}
      </div>
      <pre className="scroll-thin max-h-96 overflow-auto rounded-2xl bg-canvas p-3 font-mono text-[11px] leading-[17px] text-ink/85">
        {detail.isLoading ? 'Lädt …' : detail.isError ? (detail.error as Error).message : raw}
      </pre>
    </div>
  );
}

export function EventList({
  events,
  matchFor,
  onOpenSystem,
  compact,
  loadingMore,
  onLoadMore,
}: {
  events: WazuhEvent[];
  matchFor?: (event: WazuhEvent) => AgentMatch;
  onOpenSystem?: (id: string) => void;
  compact?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const [open, setOpen] = useState<WazuhEvent | null>(null);
  return (
    <>
      <ul className="space-y-1">
        {events.map((event, index) => {
          const match = matchFor?.(event);
          const severity = severityOf(event.rule.level);
          return (
            <motion.li key={`${event.index}/${event.id}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: Math.min(index * 0.012, 0.3) }}>
              <button
                type="button"
                onClick={() => setOpen(event)}
                className={cn(
                  'group grid w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors hover:bg-hover/50',
                  compact ? 'grid-cols-[92px_38px_minmax(0,1fr)_14px]' : 'grid-cols-[112px_38px_minmax(140px,0.6fr)_minmax(0,1.6fr)_minmax(0,0.7fr)_14px]',
                  severity === 'high' || severity === 'critical' ? 'border-bad/25 bg-bad/[0.04]' : 'border-line/[0.05]',
                )}
              >
                <span className="font-mono text-[11px] text-muted">{time(event.timestamp)}</span>
                <LevelPill level={event.rule.level} />
                {!compact && (
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium">{match?.connection?.name ?? event.agent.name}</span>
                    <span className="block truncate font-mono text-[10.5px] text-faint">{match?.connection && match.connection.name !== event.agent.name ? `${event.agent.name} · ` : ''}{event.agent.ip}</span>
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px]">{event.rule.description}</span>
                  {(event.sourceIp || event.destinationUser) && <span className="block truncate font-mono text-[10.5px] text-faint">{[event.sourceIp, event.destinationUser].filter(Boolean).join(' · ')}</span>}
                </span>
                {!compact && <span className="truncate text-[11px] text-faint">{event.rule.groups.slice(0, 3).join(', ')}</span>}
                <ChevronRight className="size-3.5 text-faint transition-transform group-hover:translate-x-0.5" />
              </button>
            </motion.li>
          );
        })}
      </ul>
      {onLoadMore && (
        <button type="button" onClick={onLoadMore} disabled={loadingMore} className="mx-auto mt-3 flex h-9 items-center gap-2 rounded-full border border-line/[0.12] px-4 text-[12.5px] hover:bg-raised disabled:opacity-50">
          {loadingMore && <Loader2 className="size-3.5 animate-spin" />} Ältere laden
        </button>
      )}
      <Drawer open={!!open} onClose={() => setOpen(null)} label="Wazuh-Event" width={680}>
        {open && <EventDetail key={`${open.index}/${open.id}`} event={open} match={matchFor?.(open)} onOpenSystem={(id) => { setOpen(null); onOpenSystem?.(id); }} />}
      </Drawer>
    </>
  );
}
