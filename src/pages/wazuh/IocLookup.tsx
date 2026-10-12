import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Crosshair, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { Shimmer } from '@/components/systems/fx';
import { LevelPill } from '@/components/wazuh/EventList';
import { EventTable } from '@/components/soc/EventTable';
import { EventDrawer } from '@/components/soc/EventDrawer';
import { useSocIoc } from '@/hooks/use-soc';
import { RANGES, eventKey, formatTime } from '@/lib/soc';
import { formatCount } from '@/lib/wazuh';
import type { SocEvent } from '@/services/soc';

const TYPE_LABEL = { ip: 'IP-Adresse', hash: 'Hash', url: 'URL', domain: 'Domain', text: 'Text/Benutzer/Host' } as const;
const RECENT_KEY = 'sar.iocRecent';
const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
};

export function IocLookup() {
  const [params, setParams] = useSearchParams();
  const value = params.get('value');
  const hours = Number(params.get('hours')) || 24 * 7;
  const [draft, setDraft] = useState(value ?? '');
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [open, setOpen] = useState<SocEvent | null>(null);
  const result = useSocIoc(value, hours);
  const r = result.data;

  const lookup = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const next = [trimmed, ...recent.filter((entry) => entry !== trimmed)].slice(0, 8);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    setParams({ value: trimmed, ...(hours !== 24 * 7 ? { hours: String(hours) } : {}) }, { replace: true });
  };
  const maxBar = Math.max(1, ...(r?.timeline ?? []).map((bucket) => bucket.total));

  return (
    <>
      <PageHeader section="Threat Intelligence" title="IOC-Lookup" description="Einen Indikator (IP, Domain, Hash, URL, Benutzer, Prozess) in allen Wazuh-Events suchen" />

      <NotchCard index={0} eyebrow="Indikator" title="Suchen" bodyClassName="pt-3">
        <form onSubmit={(event) => { event.preventDefault(); lookup(draft); }} className="flex h-12 items-center gap-2.5 rounded-2xl border border-line/[0.12] bg-raised/50 px-4 focus-within:border-accent/45">
          <Crosshair className="size-4 text-muted" />
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="z. B. 92.224.137.46, evil.example.com, 44d88612fea8a8f36de82e1278abb02f, mimikatz" className="h-full min-w-0 flex-1 bg-transparent font-mono text-[13.5px] outline-none placeholder:font-sans placeholder:text-faint" />
          <button type="submit" className="h-9 rounded-full bg-gradient-to-r from-accent-strong to-accent px-5 text-[13px] font-medium text-accent-ink">Prüfen</button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-line/[0.12] p-1">
            {RANGES.map((range) => (
              <button key={range.hours} type="button" onClick={() => { const next = new URLSearchParams(params); next.set('hours', String(range.hours)); setParams(next, { replace: true }); }} className={cn('relative h-7 rounded-full px-3 text-[12px]', hours === range.hours ? 'text-ink' : 'text-muted hover:text-ink')}>
                {hours === range.hours && <motion.span layoutId="ioc-range" className="absolute inset-0 rounded-full border border-accent/30 bg-accent/[0.12]" />}
                <span className="relative">{range.label}</span>
              </button>
            ))}
          </div>
          {recent.map((entry) => <button key={entry} type="button" onClick={() => { setDraft(entry); lookup(entry); }} className="rounded-full border border-line/[0.08] px-2.5 py-0.5 font-mono text-[11px] text-muted hover:text-ink">{entry}</button>)}
        </div>
      </NotchCard>

      {value && (
        <>
          {!r ? (
            <Shimmer className="mt-5 h-40 w-full rounded-3xl" />
          ) : (
            <>
              <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[
                  ['Typ', TYPE_LABEL[r.type]],
                  ['Treffer', formatCount(r.total)],
                  ['Hosts', r.hosts.length],
                  ['Zeitraum', r.first ? `${formatTime(r.first, true)} – ${formatTime(r.last, true)}` : '–'],
                ].map(([label, text]) => (
                  <div key={label as string} className="panel-surface rounded-2xl px-4 py-3">
                    <p className="text-[11.5px] text-muted">{label}</p>
                    <p className="mt-1 truncate text-[16px] font-semibold">{text}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-start gap-2 rounded-2xl border border-line/[0.10] bg-raised/30 px-4 py-3 text-[12.5px] text-muted">
                <Info className="mt-0.5 size-4 shrink-0" />
                <span>
                  {r.type === 'ip' && (r.publicIp ? 'Öffentliche IP-Adresse. ' : 'Interne IP-Adresse. ')}
                  Threat-Intel: keine externe Quelle angebunden, daher keine Aussage, ob der Wert als bösartig bekannt ist. Die Suche zeigt nur, wo er in euren Events vorkommt.
                </span>
              </div>
              {r.total > 0 && (
                <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <NotchCard index={1} eyebrow="wo gesehen" title="Hosts & Regeln" bodyClassName="pt-3">
                    <div className="mb-4 flex flex-wrap gap-1.5">{r.hosts.map((entry) => <span key={entry.name} className="rounded-full border border-line/[0.10] px-2 py-0.5 text-[11.5px]">{entry.name} <span className="font-mono text-faint">{formatCount(entry.count)}</span></span>)}</div>
                    <ul className="space-y-1">{r.rules.map((rule) => <li key={rule.id} className="flex items-center gap-2 text-[12px]"><LevelPill level={rule.maxLevel} /><span className="truncate">{rule.description}</span><span className="ml-auto font-mono text-faint">{formatCount(rule.count)}</span></li>)}</ul>
                  </NotchCard>
                  <NotchCard index={2} eyebrow="wann gesehen" title="Verlauf" bodyClassName="pt-3">
                    <div className="flex h-32 items-end gap-px">
                      {r.timeline.map((bucket) => <motion.span key={bucket.time} className="flex-1 rounded-t-sm bg-accent/70" initial={{ height: 0 }} animate={{ height: `${bucket.total ? Math.max(4, (bucket.total / maxBar) * 100) : 0}%` }} title={`${new Date(bucket.time * 1000).toLocaleString('de-DE')}: ${bucket.total}`} />)}
                    </div>
                  </NotchCard>
                </div>
              )}
              <NotchCard index={3} className="mt-5" eyebrow="neueste Treffer" title="Events" bodyClassName="pt-3">
                <EventTable events={r.events} selected={open ? eventKey(open) : null} onSelect={setOpen} showDate />
              </NotchCard>
            </>
          )}
        </>
      )}
      <EventDrawer event={open} onClose={() => setOpen(null)} />
    </>
  );
}
