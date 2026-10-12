import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Link2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { Shimmer } from '@/components/systems/fx';
import { LevelPill } from '@/components/wazuh/EventList';
import { RiskBadge, VerdictBadge } from '@/components/soc/badges';
import { EventDrawer } from '@/components/soc/EventDrawer';
import { QueryBar } from '@/components/soc/QueryBar';
import { useSocWindow } from '@/hooks/use-soc';
import { RISK } from '@/lib/soc';
import type { SocEvent } from '@/services/soc';

const WINDOWS = [
  { minutes: 15, label: '15 min' },
  { minutes: 60, label: '1 h' },
  { minutes: 360, label: '6 h' },
  { minutes: 1440, label: '24 h' },
];

/** Step of a typical attack chain an event belongs to */
function stage(event: SocEvent): { key: string; label: string } | null {
  const id = event.eventId;
  const groups = event.rule.groups;
  if (id === '4625' || id === '4771' || groups.includes('authentication_failed') || groups.includes('authentication_failures') || groups.includes('invalid_login')) return { key: 'fail', label: 'Fehlanmeldung' };
  if (id === '4624' || groups.includes('authentication_success')) return { key: 'login', label: 'Anmeldung' };
  if (id === '4672' || groups.includes('sudo')) return { key: 'priv', label: 'Rechte' };
  if (id === '4688') return { key: 'process', label: 'Prozess' };
  if (['4697', '7045', '4698', '4720', '4732', '4728'].includes(id ?? '')) return { key: 'persist', label: 'Persistenz' };
  return null;
}

export function Timeline() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const minutes = Number(params.get('window')) || 60;
  const center = params.get('at') ? new Date(params.get('at')!).getTime() : null;
  const [hideRoutine, setHideRoutine] = useState(false);
  const [open, setOpen] = useState<SocEvent | null>(null);
  // Without a reference point the window ends "now"; fixed until "Bis jetzt" is clicked, so the query key stays stable
  const [now, setNow] = useState(() => Date.now());
  const end = center ? center + (minutes / 2) * 60_000 : now;
  const start = end - minutes * 60_000;
  const window = useMemo(() => ({ from: new Date(start).toISOString(), to: new Date(end).toISOString() }), [start, end]);
  const result = useSocWindow(q, window, hideRoutine ? 4 : undefined);

  const set = (entries: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    Object.entries(entries).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)));
    setParams(next, { replace: true });
  };
  const shift = (direction: -1 | 1) => set({ at: new Date((center ?? end - (minutes / 2) * 60_000) + direction * minutes * 60_000).toISOString() });

  const events = useMemo(() => result.data?.events ?? [], [result.data]);
  // group by minute
  const groups = useMemo(() => {
    const map = new Map<string, SocEvent[]>();
    events.forEach((event) => {
      const minute = new Date(event.timestamp);
      minute.setSeconds(0, 0);
      const key = minute.toISOString();
      map.set(key, [...(map.get(key) ?? []), event]);
    });
    return [...map.entries()];
  }, [events]);

  // chain: failed logins followed by a successful one (and maybe privileges / process / persistence) for the same user
  const chain = useMemo(() => {
    const byUser = new Map<string, string[]>();
    events.forEach((event) => {
      const step = stage(event);
      if (!step || !event.user) return;
      byUser.set(event.user, [...(byUser.get(event.user) ?? []), step.key]);
    });
    for (const [user, steps] of byUser) {
      const failIndex = steps.indexOf('fail');
      if (failIndex >= 0 && steps.slice(failIndex).includes('login')) return { user, steps: [...new Set(steps.slice(failIndex))] };
    }
    return null;
  }, [events]);

  return (
    <>
      <PageHeader section="Explore" title="Timeline" description="Was passierte zuerst, was danach? Ereigniskette eines Hosts oder Benutzers im gewählten Zeitfenster" />

      <NotchCard index={0} eyebrow="Fenster" title="Abfrage" bodyClassName="pt-3">
        <QueryBar key={q} value={q} onSubmit={(value) => set({ q: value || undefined })} placeholder='z. B. host:"dc02" oder user:Administrator' />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => shift(-1)} className="flex size-9 items-center justify-center rounded-full border border-line/[0.12] hover:bg-raised" aria-label="Früher"><ChevronLeft className="size-4" /></button>
          <div className="flex rounded-full border border-line/[0.12] p-1">
            {WINDOWS.map((entry) => (
              <button key={entry.minutes} type="button" onClick={() => set({ window: entry.minutes === 60 ? undefined : String(entry.minutes) })} className={cn('relative h-7 rounded-full px-3 text-[12px]', minutes === entry.minutes ? 'text-ink' : 'text-muted hover:text-ink')}>
                {minutes === entry.minutes && <motion.span layoutId="tl-window" className="absolute inset-0 rounded-full border border-accent/30 bg-accent/[0.12]" />}
                <span className="relative">{entry.label}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => shift(1)} disabled={!center} className="flex size-9 items-center justify-center rounded-full border border-line/[0.12] hover:bg-raised disabled:opacity-40" aria-label="Später"><ChevronRight className="size-4" /></button>
          <button type="button" onClick={() => { setNow(Date.now()); set({ at: undefined }); }} className="h-9 rounded-full border border-line/[0.12] px-3 text-[12px] text-muted hover:text-ink">Bis jetzt</button>
          <label className="ml-2 flex items-center gap-2 text-[12px] text-muted">
            <input type="checkbox" checked={hideRoutine} onChange={(event) => setHideRoutine(event.target.checked)} className="accent-[rgb(var(--accent))]" /> Routine (Level 0–3) ausblenden
          </label>
          <span className="ml-auto font-mono text-[11.5px] text-faint">{new Date(start).toLocaleString('de-DE')} – {new Date(end).toLocaleTimeString('de-DE')}</span>
          {result.isFetching && <Loader2 className="size-4 animate-spin text-muted" />}
        </div>
      </NotchCard>

      {chain && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-5 flex items-start gap-3 rounded-2xl border border-bad/35 bg-bad/[0.06] p-4 text-[13px]">
          <Link2 className="mt-0.5 size-4 shrink-0 text-bad" />
          <div>
            <p className="font-medium">Mögliche Kette für {chain.user}: {chain.steps.map((step) => ({ fail: 'Fehlanmeldungen', login: 'erfolgreiche Anmeldung', priv: 'Rechte', process: 'Prozessstart', persist: 'Persistenz' })[step]).join(' → ')}</p>
            <p className="mt-1 text-muted">Fehlanmeldungen, auf die eine erfolgreiche Anmeldung desselben Kontos folgt, sind ein typisches Muster für erratene Passwörter. Quelle und Konto prüfen.</p>
          </div>
        </motion.div>
      )}

      <NotchCard index={1} className="mt-5" eyebrow={result.data ? `${events.length}${events.length === 400 ? '+ (gekürzt)' : ''} Events` : 'Events'} title="Ablauf" bodyClassName="pt-4">
        {result.isError ? (
          <p className="py-10 text-center text-[13px] text-bad">{(result.error as Error).message}</p>
        ) : !result.data ? (
          <div className="space-y-2">{Array.from({ length: 8 }, (_, index) => <Shimmer key={index} className="h-10" />)}</div>
        ) : !events.length ? (
          <p className="py-10 text-center text-[13px] text-muted">Keine Events in diesem Fenster.</p>
        ) : (
          <ol className="relative ml-[86px] border-l border-line/[0.10]">
            {groups.map(([minute, list]) => (
              <li key={minute} className="relative pb-3 pl-5">
                <span className="absolute -left-[86px] top-1 w-[72px] text-right font-mono text-[11.5px] text-muted">{new Date(minute).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="absolute -left-[5px] top-2 size-[9px] rounded-full border-2 border-canvas" style={{ background: list.some((event) => ['high', 'critical'].includes(event.assessment.risk)) ? 'rgb(var(--bad))' : list.some((event) => event.assessment.risk === 'medium') ? 'rgb(var(--accent))' : 'rgb(var(--faint))' }} />
                <ul className="space-y-1">
                  {list.map((event) => {
                    const step = stage(event);
                    return (
                      <li key={`${event.index}/${event.id}`}>
                        <button type="button" onClick={() => setOpen(event)} className={cn('flex w-full items-center gap-3 rounded-xl border px-3 py-1.5 text-left text-[12.5px] transition-colors hover:bg-hover/50', ['high', 'critical'].includes(event.assessment.risk) ? 'border-bad/30' : 'border-line/[0.05]')}>
                          <span className="font-mono text-[11px] text-faint">:{new Date(event.timestamp).getSeconds().toString().padStart(2, '0')}</span>
                          <LevelPill level={event.rule.level} />
                          {step && <span className={cn('rounded-full border px-2 py-px text-[10.5px]', step.key === 'fail' ? 'border-bad/35 text-bad' : step.key === 'persist' ? 'border-bad/35 text-bad' : 'border-line/[0.12] text-muted')}>{step.label}</span>}
                          <span className="min-w-0 flex-1 truncate">{event.rule.description}</span>
                          <span className="hidden truncate font-mono text-[11px] text-muted md:block">{event.agent.name}{event.user ? ` · ${event.user}` : ''}</span>
                          <VerdictBadge verdict={event.assessment.verdict} />
                          <span className="w-16"><RiskBadge risk={event.assessment.risk} /></span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-[11.5px] text-faint">Farbe am Zeitstrahl = höchstes Risiko in der Minute ({RISK.high.label}/{RISK.medium.label}/sonst).</p>
      </NotchCard>

      <EventDrawer event={open} onClose={() => setOpen(null)} />
    </>
  );
}
