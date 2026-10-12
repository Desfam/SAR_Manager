import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarRange, Loader2, Monitor, Search, Server, Terminal as TerminalIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NotchCard } from '@/components/ui/NotchCard';
import { Beacon, Shimmer } from '@/components/systems/fx';
import { LevelPill } from '@/components/wazuh/EventList';
import { QueryBar } from '@/components/soc/QueryBar';
import { EventDetail } from '@/components/investigation/EventDetail';
import { useInvestigationEvents, useInvestigationHosts } from '@/hooks/use-soc';
import { useFitHeight } from '@/hooks/use-fit';
import { RANGES, RISK, eventKey } from '@/lib/soc';
import { formatCount } from '@/lib/wazuh';
import type { EventHost, InvestigationFilter, SocEvent } from '@/services/soc';

const MIN_LEVELS: Array<{ value?: number; label: string }> = [
  { label: 'Alle' },
  { value: 4, label: '≥ 4' },
  { value: 7, label: '≥ 7' },
  { value: 10, label: '≥ 10' },
  { value: 12, label: '≥ 12' },
];
const MAX_LEVELS = [3, 6, 9, 11, 15];

/** datetime-local value (local time, minutes) */
const toLocalInput = (iso?: string) => {
  if (!iso) return '';
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

const hostIcon = (host: EventHost) => {
  const name = `${host.platform ?? ''} ${host.os ?? ''}`.toLowerCase();
  if (name.includes('windows')) return Monitor;
  if (/linux|ubuntu|debian|centos|rhel|alma|rocky/.test(name)) return TerminalIcon;
  return Server;
};

function HostList({ hosts, total, selected, onSelect, loading }: { hosts: EventHost[]; total: number; selected: string | null; onSelect: (name: string | null) => void; loading: boolean }) {
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'count' | 'level' | 'name'>('count');
  const list = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = hosts.filter((host) => !needle || `${host.name} ${host.ip ?? ''}`.toLowerCase().includes(needle));
    return filtered.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'level' ? b.maxLevel - a.maxLevel || b.count - a.count : b.count - a.count));
  }, [hosts, filter, sort]);
  const max = Math.max(1, ...hosts.map((host) => host.count));
  return (
    <>
      <label className="mb-2 flex h-9 shrink-0 items-center gap-2 rounded-full border border-line/[0.10] bg-raised/50 px-3">
        <Search className="size-3.5 text-muted" />
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="PC suchen …" className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint" />
        {filter && <button type="button" onClick={() => setFilter('')} aria-label="Leeren"><X className="size-3.5 text-muted" /></button>}
      </label>
      <div className="mb-1.5 flex shrink-0 gap-1 text-[11px]">
        {([['count', 'Events'], ['level', 'Level'], ['name', 'Name']] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setSort(key)} className={cn('rounded-full px-2 py-0.5', sort === key ? 'bg-accent/[0.12] text-ink' : 'text-muted hover:text-ink')}>{label}</button>
        ))}
      </div>
      <ul className="scroll-thin -mr-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-2">
        <li>
          <button type="button" onClick={() => onSelect(null)} className={cn('flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12.5px] hover:bg-hover/60', !selected && 'bg-accent/[0.12]')}>
            <span className="flex-1 font-medium">Alle PCs</span>
            <span className="font-mono text-[11px] text-faint">{formatCount(total)}</span>
          </button>
        </li>
        {list.map((host, index) => {
          const Icon = hostIcon(host);
          const active = selected === host.name;
          return (
            <motion.li key={host.name} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(index, 25) * 0.015 }}>
              <button type="button" onClick={() => onSelect(host.name)} className={cn('relative w-full rounded-xl px-2.5 py-1.5 text-left hover:bg-hover/60', active && 'bg-accent/[0.12]')}>
                {active && <motion.span layoutId="inv-host" className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-accent" />}
                <span className="flex items-center gap-2">
                  <Beacon tone={host.status === 'active' ? 'ok' : host.status === 'disconnected' || host.status === 'never_connected' ? 'bad' : 'muted'} size={5} />
                  <Icon className="size-3.5 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{host.name}</span>
                  <span className="font-mono text-[10.5px] text-faint">{formatCount(host.count)}</span>
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-line/[0.08]">
                    <motion.span className={cn('block h-full rounded-full', host.maxLevel >= 12 ? 'bg-bad' : host.maxLevel >= 7 ? 'bg-accent' : 'bg-muted')} initial={{ width: 0 }} animate={{ width: `${Math.max(3, (host.count / max) * 100)}%` }} transition={{ duration: 0.7 }} />
                  </span>
                  <span className="w-11 text-right font-mono text-[10px] text-faint">max {host.maxLevel}</span>
                </span>
              </button>
            </motion.li>
          );
        })}
        {loading && !hosts.length && Array.from({ length: 10 }, (_, index) => <li key={index}><Shimmer className="my-1 h-9" /></li>)}
        {!loading && !hosts.length && <li className="px-2 py-6 text-center text-[12px] text-muted">Keine PCs mit Events für diesen Filter.</li>}
      </ul>
    </>
  );
}

function EventRow({ event, active, showDate, onSelect }: { event: SocEvent; active: boolean; showDate: boolean; onSelect: () => void }) {
  const serious = event.assessment.risk === 'high' || event.assessment.risk === 'critical';
  const date = new Date(event.timestamp);
  return (
    <li>
      <button
        type="button"
        data-key={eventKey(event)}
        onClick={onSelect}
        className={cn(
          'relative grid w-full grid-cols-[auto_34px_58px_minmax(0,1fr)_minmax(0,0.45fr)_10px] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
          active ? 'bg-accent/[0.13]' : serious ? 'bg-bad/[0.05] hover:bg-bad/[0.09]' : 'hover:bg-hover/60',
        )}
      >
        {active && <motion.span layoutId="inv-event" className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-accent" />}
        <span className="font-mono text-[11px] text-faint">{showDate && <>{date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} </>}{date.toLocaleTimeString('de-DE')}</span>
        <LevelPill level={event.rule.level} />
        <span className="truncate font-mono text-[11.5px]">{event.eventId ?? event.rule.id}</span>
        <span className="truncate" title={event.rule.description}>{event.rule.description}</span>
        <span className="truncate font-mono text-[11px] text-muted">{event.user ?? event.sourceIp ?? ''}</span>
        <span className={cn('size-2 rounded-full', RISK[event.assessment.risk].dot)} />
      </button>
    </li>
  );
}

export function Investigation() {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const fitHeight = useFitHeight(rootRef);
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const host = params.get('host');
  const hours = Number(params.get('hours')) || 24;
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const minLevel = params.get('min') ? Number(params.get('min')) : undefined;
  const maxLevel = params.get('max') ? Number(params.get('max')) : undefined;
  const custom = !!(from && to);
  const [customOpen, setCustomOpen] = useState(custom);

  const set = (entries: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    Object.entries(entries).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)));
    setParams(next, { replace: true });
  };

  const base: InvestigationFilter = useMemo(() => ({ q, hours, from, to, minLevel, maxLevel }), [q, hours, from, to, minLevel, maxLevel]);
  const eventFilter: InvestigationFilter = useMemo(() => ({ ...base, q: [host ? `host:"${host}"` : '', q].filter(Boolean).join(' ') }), [base, host, q]);
  const hostsQuery = useInvestigationHosts(base);
  const events = useInvestigationEvents(eventFilter);
  const list = useMemo(() => events.data?.pages.flatMap((page) => page.events) ?? [], [events.data]);
  const total = events.data?.pages[0]?.total ?? 0;
  const totalExact = events.data?.pages[0]?.totalExact ?? true;
  const showDate = custom || hours > 24;

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = list.find((event) => eventKey(event) === selectedKey) ?? null;
  // keep a selection: newest event when nothing (or something no longer listed) is selected
  useEffect(() => {
    if (list.length && !selected) setSelectedKey(eventKey(list[0]));
  }, [list, selected]);

  // load the next page when the end of the list scrolls into view
  const sentinel = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const element = sentinel.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && events.hasNextPage && !events.isFetchingNextPage) void events.fetchNextPage();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [events]);

  // arrow keys move through the list
  const move = (direction: 1 | -1) => {
    const index = list.findIndex((event) => eventKey(event) === selectedKey);
    const next = list[Math.max(0, Math.min(list.length - 1, index + direction))];
    if (!next) return;
    setSelectedKey(eventKey(next));
    listRef.current?.querySelector(`[data-key="${CSS.escape(eventKey(next))}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <div ref={rootRef} className="flex flex-col gap-3" style={fitHeight ? { height: fitHeight } : undefined}>
      {/* filter bar */}
      <NotchCard index={0} className="shrink-0" bodyClassName="gap-2.5 py-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Investigation</h1>
          <div className="min-w-[280px] flex-1"><QueryBar key={q} value={q} onSubmit={(value) => set({ q: value || undefined })} placeholder='Optional: Suchbegriff oder user:Administrator eid:4625 ip:… rule:…' /></div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-muted">Zeitraum</span>
          <div className="flex rounded-full border border-line/[0.12] p-0.5">
            {RANGES.map((range) => (
              <button key={range.hours} type="button" onClick={() => { setCustomOpen(false); set({ hours: range.hours === 24 ? undefined : String(range.hours), from: undefined, to: undefined }); }} className={cn('relative h-7 rounded-full px-3', !custom && hours === range.hours ? 'text-ink' : 'text-muted hover:text-ink')}>
                {!custom && hours === range.hours && <motion.span layoutId="inv-range" className="absolute inset-0 rounded-full border border-accent/30 bg-accent/[0.12]" />}
                <span className="relative">{range.label}</span>
              </button>
            ))}
            <button type="button" onClick={() => setCustomOpen(!customOpen)} className={cn('flex h-7 items-center gap-1 rounded-full px-3', custom || customOpen ? 'bg-accent/[0.12] text-ink' : 'text-muted hover:text-ink')}><CalendarRange className="size-3.5" /> Eigener</button>
          </div>
          <AnimatePresence>
            {customOpen && (
              <motion.div initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }} className="flex items-center gap-1.5 overflow-hidden">
                <input type="datetime-local" defaultValue={toLocalInput(from)} id="inv-from" className="h-8 rounded-full border border-line/[0.12] bg-raised/50 px-2.5 text-[12px] outline-none [color-scheme:dark] focus:border-accent/45" />
                <span className="text-muted">bis</span>
                <input type="datetime-local" defaultValue={toLocalInput(to) || toLocalInput(new Date().toISOString())} id="inv-to" className="h-8 rounded-full border border-line/[0.12] bg-raised/50 px-2.5 text-[12px] outline-none [color-scheme:dark] focus:border-accent/45" />
                <button
                  type="button"
                  onClick={() => {
                    const start = (document.getElementById('inv-from') as HTMLInputElement).value;
                    const end = (document.getElementById('inv-to') as HTMLInputElement).value;
                    if (start && end && new Date(start) < new Date(end)) set({ from: new Date(start).toISOString(), to: new Date(end).toISOString(), hours: undefined });
                  }}
                  className="h-8 rounded-full bg-accent/[0.15] px-3 text-ink hover:bg-accent/25"
                >
                  Anwenden
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          <span className="ml-3 text-muted">Stufe</span>
          <div className="flex rounded-full border border-line/[0.12] p-0.5">
            {MIN_LEVELS.map((entry) => (
              <button key={entry.label} type="button" onClick={() => set({ min: entry.value ? String(entry.value) : undefined })} className={cn('relative h-7 rounded-full px-3', minLevel === entry.value ? 'text-ink' : 'text-muted hover:text-ink')}>
                {minLevel === entry.value && <motion.span layoutId="inv-level" className="absolute inset-0 rounded-full border border-accent/30 bg-accent/[0.12]" />}
                <span className="relative">{entry.label}</span>
              </button>
            ))}
          </div>
          <select value={maxLevel ?? 15} onChange={(event) => set({ max: Number(event.target.value) === 15 ? undefined : event.target.value })} className="h-8 rounded-full border border-line/[0.12] bg-raised/60 px-2.5 text-[12px] outline-none" aria-label="Höchstes Level">
            {MAX_LEVELS.map((value) => <option key={value} value={value}>bis Level {value}</option>)}
          </select>
          {(q || custom || minLevel || maxLevel || host) && (
            <button type="button" onClick={() => { setCustomOpen(false); setParams({}, { replace: true }); }} className="ml-auto flex items-center gap-1 text-muted hover:text-ink"><X className="size-3.5" /> Filter zurücksetzen</button>
          )}
        </div>
      </NotchCard>

      {/* three columns */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[250px_minmax(0,1.15fr)_minmax(400px,1fr)]">
        <NotchCard index={1} eyebrow={`${hostsQuery.data?.hosts.length ?? 0} mit Events`} title="PCs" className="min-h-[420px]" bodyClassName="min-h-0 pt-2.5">
          <HostList hosts={hostsQuery.data?.hosts ?? []} total={hostsQuery.data?.total ?? 0} selected={host} onSelect={(name) => set({ host: name ?? undefined })} loading={hostsQuery.isLoading} />
        </NotchCard>

        <NotchCard
          index={2}
          eyebrow={events.data ? `${totalExact ? formatCount(total) : `über ${formatCount(total)}`} Events · neueste oben` : 'lädt'}
          title={host ?? 'Alle PCs'}
          className="min-h-[420px]"
          bodyClassName="min-h-0 pt-2"
        >
          {events.isFetching && !events.isFetchingNextPage && <Loader2 className="absolute right-6 top-[-34px] size-4 animate-spin text-muted" />}
          {events.isError ? (
            <p className="py-10 text-center text-[12.5px] text-bad">{(events.error as Error).message}</p>
          ) : !events.data ? (
            <div className="space-y-1">{Array.from({ length: 14 }, (_, index) => <Shimmer key={index} className="h-8" />)}</div>
          ) : !list.length ? (
            <p className="py-10 text-center text-[12.5px] text-muted">Keine Events für diesen Filter.</p>
          ) : (
            <ul
              ref={listRef}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  move(event.key === 'ArrowDown' ? 1 : -1);
                }
              }}
              className={cn('scroll-thin -mr-2 min-h-0 flex-1 space-y-px overflow-y-auto pr-2 outline-none transition-opacity', events.isFetching && !events.isFetchingNextPage && 'opacity-60')}
            >
              {list.map((event) => <EventRow key={eventKey(event)} event={event} active={eventKey(event) === selectedKey} showDate={showDate} onSelect={() => setSelectedKey(eventKey(event))} />)}
              <li ref={sentinel} className="py-3 text-center text-[11.5px] text-faint">
                {events.isFetchingNextPage ? <Loader2 className="mx-auto size-4 animate-spin" /> : events.hasNextPage ? 'Mehr laden …' : `${list.length} Events geladen`}
              </li>
            </ul>
          )}
        </NotchCard>

        <NotchCard index={3} eyebrow="Pfeiltasten wechseln das Event" title="Event-Details" className="min-h-[420px]" bodyClassName="min-h-0 pt-3">
          <div className="scroll-thin -mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
            <AnimatePresence mode="wait">
              <EventDetail key={selected ? eventKey(selected) : 'none'} event={selected} />
            </AnimatePresence>
          </div>
        </NotchCard>
      </div>
    </div>
  );
}
