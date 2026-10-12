import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MotionConfig, motion } from 'motion/react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { ArrowUpRight, Container, Loader2, Monitor, RefreshCw, Search, ShieldAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { AnimatedNumber } from '@/components/ui/viz';
import { Beacon, FillBar, Shimmer, Stagger } from '@/components/systems/fx';
import { EventList, LevelPill } from '@/components/wazuh/EventList';
import { staggerChild } from '@/lib/fx';
import { useConnections } from '@/hooks/use-infrastructure';
import { useGuestNetworks, useLanScan } from '@/hooks/use-network';
import { DEVICE_KINDS } from '@/lib/devices';
import { useWazuhEvents, useWazuhStatus, useWazuhSummary } from '@/hooks/use-wazuh';
import type { WazuhFilters } from '@/services/wazuh';
import { SEVERITY, formatCount, matchAgent, severityOf, type SeverityKey } from '@/lib/wazuh';

const RANGES = [
  { hours: 1, label: '1 h' },
  { hours: 24, label: '24 h' },
  { hours: 24 * 7, label: '7 T' },
  { hours: 24 * 30, label: '30 T' },
];

const LEVELS: Array<{ value: number | undefined; label: string }> = [
  { value: undefined, label: 'Alle' },
  { value: 7, label: 'ab Mittel (7)' },
  { value: 12, label: 'ab Hoch (12)' },
];

function TimelineTip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const date = new Date(Number(label) * 1000);
  return (
    <div className="panel-surface rounded-xl px-3 py-2 text-[12px] shadow-xl">
      <p className="mb-1 text-muted">{date.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
      {[...payload].reverse().map((entry) => (
        <p key={entry.dataKey as string} className="flex justify-between gap-6">
          <span style={{ color: entry.color }}>{SEVERITY[entry.dataKey as SeverityKey].label}</span>
          <span className="font-mono">{Number(entry.value).toLocaleString('de-DE')}</span>
        </p>
      ))}
    </div>
  );
}

export function WazuhPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = useWazuhStatus();
  const connections = useConnections();
  const guests = useGuestNetworks();
  const lanScan = useLanScan();

  // Filters live in the URL so a filtered view can be linked (e.g. from the server overview)
  const filters: WazuhFilters = {
    hours: Number(params.get('hours')) || 24,
    agent: params.get('agent') ?? undefined,
    minLevel: params.get('minLevel') ? Number(params.get('minLevel')) : undefined,
    group: params.get('group') ?? undefined,
    ruleId: params.get('ruleId') ?? undefined,
    srcip: params.get('srcip') ?? undefined,
    q: params.get('q') ?? undefined,
  };
  const setFilter = (key: keyof WazuhFilters, value: string | number | undefined) => {
    const next = new URLSearchParams(params);
    if (value === undefined || value === '') next.delete(key);
    else next.set(key, String(value));
    setParams(next, { replace: true });
  };
  const [search, setSearch] = useState(filters.q ?? '');
  const [hidden, setHidden] = useState<Set<SeverityKey>>(new Set());
  const toggleSeverity = (key: SeverityKey) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((search.trim() || undefined) !== filters.q) setFilter('q', search.trim() || undefined);
    }, 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const ready = status.data?.configured === true;
  const summary = useWazuhSummary(filters, ready);
  const events = useWazuhEvents(filters, 100, ready);
  const s = summary.data;
  const allEvents = useMemo(() => events.data?.pages.flatMap((page) => page.events) ?? [], [events.data]);

  const matchFor = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof matchAgent>>();
    return (agent: { name?: string; ip?: string }) => {
      const key = `${agent.name}|${agent.ip}`;
      if (!cache.has(key)) cache.set(key, matchAgent(agent, connections.data ?? [], guests.data ?? [], lanScan.data?.last?.devices ?? []));
      return cache.get(key)!;
    };
  }, [connections.data, guests.data, lanScan.data]);

  const agents = s?.agents ?? [];
  const matched = agents.filter((agent) => {
    const match = matchFor(agent);
    return match.connection || match.guest;
  }).length;
  const onLan = agents.filter((agent) => {
    const match = matchFor(agent);
    return !match.connection && !match.guest && match.device;
  }).length;
  const maxAgentCount = Math.max(1, ...agents.map((agent) => agent.count));
  const activeFilters = (['agent', 'ruleId', 'group', 'srcip', 'q'] as const).filter((key) => filters[key]);
  const ruleName = filters.ruleId ? [...(s?.topRules ?? []), ...(s?.frequentRules ?? [])].find((rule) => rule.id === filters.ruleId)?.description : undefined;

  if (status.data && !status.data.configured) {
    return (
      <>
        <PageHeader section="Explore" title="Statistik" description="Sicherheits-Events aus dem Wazuh-Indexer, zugeordnet zu deinen Systemen" />
        <NotchCard index={0} eyebrow="Nicht eingerichtet" title="Wazuh-Indexer fehlt">
          <p className="mt-2 text-[13px] text-muted">In <span className="font-mono">backend/.env</span> <span className="font-mono">WAZUH_INDEXER_URL</span>, <span className="font-mono">WAZUH_INDEXER_USERNAME</span> und <span className="font-mono">WAZUH_INDEXER_PASSWORD</span> setzen.</p>
        </NotchCard>
      </>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <PageHeader
        section="Explore"
        title="Statistik"
        description="Sicherheits-Events aus dem Wazuh-Indexer, zugeordnet zu deinen Systemen und Proxmox-Gästen"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-10 items-center gap-2.5 rounded-full border border-line/[0.12] px-4 text-[12.5px]" title={status.data?.url}>
              <Beacon tone={status.isError ? 'bad' : ready ? 'ok' : 'muted'} size={7} />
              {status.isError ? <span className="text-bad">{(status.error as Error).message}</span> : ready ? <span className="text-muted">Indexer {status.data?.version} · {formatCount(status.data?.documents ?? 0)} Events · {status.data?.latencyMs} ms</span> : 'Verbinde …'}
            </span>
            <div className="flex rounded-full border border-line/[0.12] p-1">
              {RANGES.map((range) => (
                <button key={range.hours} type="button" onClick={() => setFilter('hours', range.hours === 24 ? undefined : range.hours)} className={cn('relative h-8 rounded-full px-3 text-[12.5px]', filters.hours === range.hours ? 'text-ink' : 'text-muted hover:text-ink')}>
                  {filters.hours === range.hours && <motion.span layoutId="wazuh-range" className="absolute inset-0 rounded-full border border-accent/30 bg-accent/[0.12]" />}
                  <span className="relative">{range.label}</span>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => { void summary.refetch(); void events.refetch(); }} className="flex size-10 items-center justify-center rounded-full border border-line/[0.12] hover:bg-raised" aria-label="Aktualisieren">
              <RefreshCw className={cn('size-4', (summary.isFetching || events.isFetching) && 'animate-spin')} />
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
        <NotchCard index={0} glow className="min-h-[150px]" eyebrow={`Letzte ${RANGES.find((range) => range.hours === filters.hours)?.label ?? `${filters.hours} h`}`} title="Events">
          <p className="mt-3 text-[40px] font-bold leading-none tracking-[-0.03em]">{s ? <AnimatedNumber value={s.total} /> : <Shimmer className="h-10 w-32" />}</p>
          <p className="mt-2 text-[12.5px] text-muted">{activeFilters.length || filters.minLevel ? 'mit aktuellem Filter' : 'alle Agents'}</p>
        </NotchCard>
        <NotchCard index={1} className="min-h-[150px]" tone={(s?.severity.high ?? 0) + (s?.severity.critical ?? 0) > 0 ? 'bad' : undefined} eyebrow="Level 12–15" title="Hoch & kritisch" onClick={() => setFilter('minLevel', 12)} ariaLabel="Nur hohe Events zeigen">
          <p className={cn('mt-3 text-[40px] font-bold leading-none tracking-[-0.03em]', (s?.severity.high ?? 0) + (s?.severity.critical ?? 0) ? 'text-bad' : 'text-ok')}>
            {s ? <AnimatedNumber value={s.severity.high + s.severity.critical} /> : <Shimmer className="h-10 w-20" />}
          </p>
          <p className="mt-2 text-[12.5px] text-muted">{s?.severity.critical ? `${s.severity.critical} kritisch` : 'davon 0 kritisch'}</p>
        </NotchCard>
        <NotchCard index={2} className="min-h-[150px]" eyebrow="Level 7–11" title="Mittel" onClick={() => setFilter('minLevel', 7)} ariaLabel="Ab mittleren Events zeigen">
          <p className="mt-3 text-[40px] font-bold leading-none tracking-[-0.03em] text-accent">{s ? <AnimatedNumber value={s.severity.medium} /> : <Shimmer className="h-10 w-20" />}</p>
          <p className="mt-2 text-[12.5px] text-muted">{s ? `${formatCount(s.severity.low)} niedrig (0–6)` : ''}</p>
        </NotchCard>
        <NotchCard index={3} className="min-h-[150px]" eyebrow="Mit Events" title="Agents">
          <p className="mt-3 text-[40px] font-bold leading-none tracking-[-0.03em]">{s ? <AnimatedNumber value={agents.length} /> : <Shimmer className="h-10 w-16" />}</p>
          <p className="mt-2 text-[12.5px] text-muted">{matched} deinen Systemen/Proxmox-Gästen zugeordnet{onLan ? `, ${onLan} aus dem LAN-Scan` : ''}</p>
        </NotchCard>
      </div>

      {/* Timeline */}
      <NotchCard index={4} className="mt-5" eyebrow={s ? `je ${s.interval}` : 'Verlauf'} title="Events über die Zeit" bodyClassName="pt-3">
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11.5px]">
          {(['critical', 'high', 'medium', 'low'] as SeverityKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleSeverity(key)}
              title={hidden.has(key) ? 'Einblenden' : 'Ausblenden'}
              className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-all', hidden.has(key) ? 'border-line/[0.06] text-faint line-through opacity-60' : 'border-line/[0.10] text-muted hover:text-ink')}
            >
              <span className="size-2 rounded-sm" style={{ background: SEVERITY[key].color, opacity: key === 'low' ? 0.5 : 1 }} /> {SEVERITY[key].label} <span className="font-mono text-faint">{s ? formatCount(s.severity[key]) : ''}</span>
            </button>
          ))}
          <span className="ml-1 text-faint">Klick blendet aus, z. B. „Niedrig“, um seltene schwere Events zu sehen</span>
        </div>
        {s ? (
          <div style={{ height: 210 }}>
            <ResponsiveContainer>
              <BarChart data={s.timeline} margin={{ top: 6, right: 4, left: -12, bottom: 0 }} barCategoryGap={1}>
                <CartesianGrid vertical={false} stroke="rgb(var(--line) / 0.06)" />
                <XAxis
                  dataKey="time"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40}
                  tick={{ fontSize: 10.5, fill: 'rgb(var(--faint))' }}
                  tickFormatter={(value: number) => {
                    const date = new Date(value * 1000);
                    return filters.hours > 48 ? date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
                  }}
                />
                <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 10.5, fill: 'rgb(var(--faint))' }} tickFormatter={(value: number) => (value >= 1000 ? `${Math.round(value / 100) / 10}k`.replace('.', ',') : String(value))} />
                <Tooltip content={<TimelineTip />} cursor={{ fill: 'rgb(var(--line) / 0.05)' }} />
                {!hidden.has('low') && <Bar dataKey="low" stackId="s" fill="rgb(var(--faint))" fillOpacity={0.45} animationDuration={900} />}
                {!hidden.has('medium') && <Bar dataKey="medium" stackId="s" fill="rgb(var(--accent))" animationDuration={900} />}
                {!hidden.has('high') && <Bar dataKey="high" stackId="s" fill="rgb(var(--bad))" animationDuration={900} />}
                {!hidden.has('critical') && <Bar dataKey="critical" stackId="s" fill="rgb(var(--bad))" radius={[3, 3, 0, 0]} animationDuration={900} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : summary.isError ? (
          <p className="py-12 text-center text-[13px] text-bad">{(summary.error as Error).message}</p>
        ) : (
          <Shimmer className="h-[210px] w-full rounded-2xl" />
        )}
      </NotchCard>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* Agents ↔ systems */}
        <NotchCard index={5} eyebrow={`${agents.length} Agents · ${matched} zugeordnet`} title="Systeme" bodyClassName="pt-3">
          <Stagger className="scroll-thin max-h-[560px] space-y-1 overflow-y-auto pr-1">
            {agents.map((agent) => {
              const match = matchFor(agent);
              const active = filters.agent === agent.name;
              const severity = severityOf(agent.maxLevel);
              return (
                <motion.div key={agent.name} variants={staggerChild} className={cn('group flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors', active ? 'bg-accent/[0.10]' : 'hover:bg-hover/50')}>
                  <button type="button" onClick={() => setFilter('agent', active ? undefined : agent.name)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line/[0.10] bg-raised">
                      {match.guest?.type === 'lxc' ? (
                        <Container className="size-4 text-accent" />
                      ) : match.guest ? (
                        <Monitor className="size-4 text-accent" />
                      ) : match.device ? (
                        (() => {
                          const Icon = DEVICE_KINDS[match.device.kind].icon;
                          return <Icon className="size-4" style={{ color: DEVICE_KINDS[match.device.kind].color }} />;
                        })()
                      ) : (
                        <Monitor className="size-4 text-faint" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium">{agent.name}</span>
                        {match.connection && <span className="truncate rounded-full border border-accent/25 px-1.5 text-[10.5px] text-accent">{match.connection.name}</span>}
                        {!match.connection && match.guest && <span className="truncate rounded-full border border-line/[0.12] px-1.5 text-[10.5px] text-muted">{match.guest.type === 'lxc' ? 'CT' : 'VM'} {match.guest.vmid}</span>}
                        {!match.connection && !match.guest && match.device && (
                          <span className="truncate rounded-full border border-line/[0.10] px-1.5 text-[10.5px] text-faint" title="aus dem LAN-Scan (Netzwerk-Tab)">{DEVICE_KINDS[match.device.kind].label}</span>
                        )}
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <span className="w-24 shrink-0"><FillBar value={(agent.count / maxAgentCount) * 100} tone={severity === 'low' ? 'muted' : severity === 'medium' ? 'warn' : 'bad'} height={4} /></span>
                        <span className="truncate font-mono text-[10.5px] text-faint">{agent.ip} · {formatCount(agent.count)} Events{agent.serious ? ` · ${agent.serious} ab Level 7` : ''}</span>
                      </span>
                    </span>
                    <LevelPill level={agent.maxLevel} />
                  </button>
                  {match.connection && (
                    <button type="button" onClick={() => navigate(`/systems/${encodeURIComponent(match.connection!.id)}`)} className="flex size-7 shrink-0 items-center justify-center rounded-full text-faint opacity-0 transition-opacity hover:bg-raised hover:text-ink group-hover:opacity-100" aria-label={`Übersicht von ${match.connection.name}`}>
                      <ArrowUpRight className="size-3.5" />
                    </button>
                  )}
                </motion.div>
              );
            })}
            {!s && Array.from({ length: 6 }, (_, index) => <Shimmer key={index} className="h-12" />)}
          </Stagger>
        </NotchCard>

        <div className="space-y-5">
          <NotchCard index={6} eyebrow="Nach Schwere" title="Wichtigste Regeln" bodyClassName="pt-3">
            <Stagger className="space-y-1">
              {(s?.topRules ?? []).slice(0, 8).map((rule) => (
                <motion.button key={rule.id} variants={staggerChild} type="button" onClick={() => setFilter('ruleId', filters.ruleId === rule.id ? undefined : rule.id)} className={cn('flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors', filters.ruleId === rule.id ? 'bg-accent/[0.10]' : 'hover:bg-hover/50')}>
                  <LevelPill level={rule.maxLevel} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px]">{rule.description}</span>
                    <span className="block font-mono text-[10.5px] text-faint">Regel {rule.id}{rule.agents ? ` · ${rule.agents} Agents` : ''}</span>
                  </span>
                  <span className="font-mono text-[12px] text-muted">{formatCount(rule.count)}</span>
                </motion.button>
              ))}
            </Stagger>
          </NotchCard>

          <NotchCard index={7} eyebrow="Muster" title="Taktiken, Gruppen & Quellen" bodyClassName="pt-3">
            {s?.tactics.length ? (
              <>
                <p className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.08em] text-faint">MITRE ATT&CK</p>
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {s.tactics.map((tactic) => (
                    <span key={tactic.name} className="rounded-full border border-bad/25 bg-bad/[0.06] px-2.5 py-1 text-[11.5px]">{tactic.name} <span className="font-mono text-faint">{formatCount(tactic.count)}</span></span>
                  ))}
                </div>
              </>
            ) : null}
            <p className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.08em] text-faint">Regel-Gruppen</p>
            <div className="mb-4 flex flex-wrap gap-1.5">
              {(s?.groups ?? []).map((group) => (
                <button key={group.name} type="button" onClick={() => setFilter('group', filters.group === group.name ? undefined : group.name)} className={cn('rounded-full border px-2.5 py-1 text-[11.5px] transition-colors', filters.group === group.name ? 'border-accent/40 bg-accent/[0.10]' : 'border-line/[0.10] hover:border-line/[0.2]')}>
                  {group.name.trim()} <span className="font-mono text-faint">{formatCount(group.count)}</span>
                </button>
              ))}
            </div>
            <p className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.08em] text-faint">Häufigste Quell-IPs</p>
            <div className="space-y-1">
              {(s?.sources ?? []).slice(0, 6).map((source) => {
                const match = matchFor({ ip: source.ip });
                return (
                  <button key={source.ip} type="button" onClick={() => setFilter('srcip', filters.srcip === source.ip ? undefined : source.ip)} className={cn('flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors', filters.srcip === source.ip ? 'bg-accent/[0.10]' : 'hover:bg-hover/50')}>
                    <span className="font-mono">{source.ip}</span>
                    <span className="truncate text-muted">{match.connection?.name ?? match.guest?.name ?? ''}</span>
                    <span className="ml-auto font-mono text-faint">{formatCount(source.count)}</span>
                  </button>
                );
              })}
            </div>
          </NotchCard>
        </div>
      </div>

      {/* Events */}
      <NotchCard index={8} className="mt-5" eyebrow={events.data ? `${events.data.pages[0]?.totalExact === false ? 'über ' : ''}${formatCount(events.data.pages[0]?.total ?? 0)} Treffer` : 'Events'} title="Events" bodyClassName="pt-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="flex h-9 w-72 items-center gap-2 rounded-full border border-line/[0.10] bg-raised/50 px-3.5 focus-within:border-accent/40">
            <Search className="size-3.5 text-muted" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Suche: Beschreibung, Log, Benutzer, IP …" className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint" />
          </label>
          <div className="flex rounded-full border border-line/[0.10] p-1">
            {LEVELS.map((entry) => (
              <button key={entry.label} type="button" onClick={() => setFilter('minLevel', entry.value)} className={cn('h-7 rounded-full px-3 text-[12px]', filters.minLevel === entry.value ? 'bg-accent/[0.12] text-ink' : 'text-muted hover:text-ink')}>{entry.label}</button>
            ))}
          </div>
          {activeFilters.filter((key) => key !== 'q').map((key) => (
            <button key={key} type="button" onClick={() => setFilter(key, undefined)} className="flex h-8 items-center gap-1.5 rounded-full border border-accent/40 bg-accent/[0.10] px-3 text-[12px]">
              {key === 'agent' ? 'Agent' : key === 'ruleId' ? 'Regel' : key === 'group' ? 'Gruppe' : 'Quelle'}: <span className="max-w-[220px] truncate">{key === 'ruleId' ? `${filters.ruleId}${ruleName ? ` · ${ruleName}` : ''}` : filters[key]}</span> <X className="size-3" />
            </button>
          ))}
          {(events.isFetching || summary.isFetching) && <Loader2 className="size-4 animate-spin text-muted" />}
        </div>
        {events.isError ? (
          <p className="py-10 text-center text-[13px] text-bad">{(events.error as Error).message}</p>
        ) : !events.data ? (
          <div className="space-y-1">{Array.from({ length: 8 }, (_, index) => <Shimmer key={index} className="h-10" />)}</div>
        ) : allEvents.length === 0 ? (
          <p className="flex flex-col items-center py-12 text-center text-[13px] text-muted"><ShieldAlert className="mb-2 size-6" /> Keine Events für diesen Filter.</p>
        ) : (
          <EventList
            events={allEvents}
            matchFor={(event) => matchFor(event.agent)}
            onOpenSystem={(id) => navigate(`/systems/${encodeURIComponent(id)}`)}
            loadingMore={events.isFetchingNextPage}
            onLoadMore={events.hasNextPage ? () => void events.fetchNextPage() : undefined}
          />
        )}
      </NotchCard>
    </MotionConfig>
  );
}
