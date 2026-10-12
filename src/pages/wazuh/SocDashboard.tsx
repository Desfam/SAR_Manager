import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { ArrowRight, Monitor, Pause, Play, Server, ShieldAlert, Terminal as TerminalIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NotchCard } from '@/components/ui/NotchCard';
import { AnimatedNumber } from '@/components/ui/viz';
import { Beacon, Shimmer, SplitBar } from '@/components/systems/fx';
import { LevelPill } from '@/components/wazuh/EventList';
import { VerdictBadge } from '@/components/soc/badges';
import { EventDrawer } from '@/components/soc/EventDrawer';
import { useSocDashboard, useSocFleet, useSocHosts, useSocSerious } from '@/hooks/use-soc';
import { useWazuhStatus } from '@/hooks/use-wazuh';
import { useFitCount, useFitHeight } from '@/hooks/use-fit';
import { RANGES, RISK, VERDICT, eventKey } from '@/lib/soc';
import { formatCount } from '@/lib/wazuh';
import type { SocEvent, SocHost, Verdict } from '@/services/soc';

const STREAM_LEVELS: Array<{ value: number | undefined; label: string }> = [
  { value: undefined, label: 'Alle' },
  { value: 4, label: '≥4' },
  { value: 7, label: '≥7' },
  { value: 12, label: '≥12' },
];
const STREAM_ROW = 34;
const HOST_ROW = 78;

function ago(value?: string) {
  if (!value) return '–';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `vor ${seconds} s`;
  if (seconds < 3600) return `vor ${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `vor ${Math.round(seconds / 3600)} h`;
  return `vor ${Math.round(seconds / 86_400)} T`;
}

function Kpi({ index, label, children, sub, tone }: { index: number; label: string; children: React.ReactNode; sub?: React.ReactNode; tone?: 'warn' | 'bad' }) {
  return (
    <NotchCard index={index} tone={tone} bodyClassName="justify-center px-5 py-3.5">
      <p className="text-[11.5px] text-muted">{label}</p>
      <div className="mt-1 text-[26px] font-bold leading-none tracking-[-0.03em]">{children}</div>
      {sub && <div className="mt-1.5 truncate text-[11px] text-faint">{sub}</div>}
    </NotchCard>
  );
}

const platformIcon = (host: SocHost) => {
  const name = `${host.platform ?? ''} ${host.os ?? ''}`.toLowerCase();
  if (name.includes('windows')) return Monitor;
  if (/linux|ubuntu|debian|centos|rhel|alma|rocky/.test(name)) return TerminalIcon;
  return Server;
};

/** Compact host card: status, system, risk bar, events and CVEs */
function HostTile({ host, index, onOpen }: { host: SocHost; index: number; onOpen: () => void }) {
  const Icon = platformIcon(host);
  const offline = host.status === 'disconnected' || host.status === 'never_connected';
  const riskTone = host.risk >= 60 ? 'rgb(var(--bad))' : host.risk >= 35 ? 'rgb(var(--accent))' : 'rgb(var(--ok))';
  return (
    <motion.button
      type="button"
      layout
      onClick={onOpen}
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.4, delay: 0.15 + index * 0.035, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2 }}
      className="group flex h-[70px] min-w-0 flex-col justify-between rounded-2xl border border-line/[0.08] bg-raised/40 px-3 py-2 text-left transition-colors hover:border-accent/35"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Beacon tone={host.status === 'active' ? 'ok' : offline ? 'bad' : 'muted'} size={6} />
        <Icon className="size-3.5 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{host.name}</span>
        <span className="font-mono text-[11px]" style={{ color: riskTone }}>{host.risk}</span>
      </span>
      <span className="block h-1 overflow-hidden rounded-full bg-line/[0.08]">
        <motion.span className="block h-full rounded-full" style={{ background: riskTone }} initial={{ width: 0 }} animate={{ width: `${Math.max(3, host.risk)}%` }} transition={{ duration: 0.9, delay: 0.25 + index * 0.035, ease: [0.22, 1, 0.36, 1] }} />
      </span>
      <span className="flex min-w-0 items-center gap-2 text-[10.5px] text-faint">
        <span className="min-w-0 flex-1 truncate">{offline ? <span className="text-bad">offline</span> : host.os ?? host.ip ?? '–'}</span>
        <span className="shrink-0 font-mono">{formatCount(host.events ?? 0)} Ev</span>
        {!!host.serious && <span className="shrink-0 font-mono text-accent">{host.serious}≥7</span>}
        {!!host.critical && <span className="shrink-0 font-mono text-bad">{host.critical} CVE</span>}
      </span>
    </motion.button>
  );
}

/** One line of the live stream; new events slide in */
function StreamRow({ event, onOpen }: { event: SocEvent; onOpen: () => void }) {
  const serious = event.assessment.risk === 'high' || event.assessment.risk === 'critical';
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, x: -14, backgroundColor: 'rgb(var(--accent) / 0.18)' }}
      animate={{ opacity: 1, x: 0, backgroundColor: 'rgb(var(--accent) / 0)' }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, backgroundColor: { duration: 1.6 } }}
      className="rounded-lg"
    >
      <button type="button" onClick={onOpen} className={cn('grid h-[32px] w-full grid-cols-[62px_34px_minmax(70px,0.55fr)_minmax(0,1.6fr)_10px] items-center gap-2.5 rounded-lg px-2 text-left text-[12px] hover:bg-hover/60', serious && 'bg-bad/[0.05]')}>
        <span className="font-mono text-[10.5px] text-faint">{new Date(event.timestamp).toLocaleTimeString('de-DE')}</span>
        <LevelPill level={event.rule.level} />
        <span className="truncate font-medium">{event.agent.name}</span>
        <span className="truncate text-muted" title={event.rule.description}>{event.rule.description}</span>
        <span className={cn('size-2 rounded-full', RISK[event.assessment.risk].dot)} title={`${VERDICT[event.assessment.verdict].label} · Risiko ${RISK[event.assessment.risk].label}`} />
      </button>
    </motion.li>
  );
}

const VERDICT_ORDER: Verdict[] = ['critical', 'suspicious', 'review', 'likely_benign', 'informational'];
const VERDICT_COLOR: Record<Verdict, string> = {
  critical: 'rgb(var(--bad))',
  suspicious: 'rgb(var(--bad) / 0.6)',
  review: 'rgb(var(--accent))',
  likely_benign: 'rgb(var(--ok))',
  informational: 'rgb(var(--line) / 0.25)',
};

export function SocDashboard() {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const hostsRef = useRef<HTMLDivElement>(null);
  const fitHeight = useFitHeight(rootRef);
  const streamRows = useFitCount(streamRef, STREAM_ROW, 14);
  const hostRows = useFitCount(hostsRef, HOST_ROW, 6);
  const highlightRef = useRef<HTMLDivElement>(null);
  const highlightSpace = useFitCount(highlightRef, 30, 10);

  const [hours, setHours] = useState(24);
  const [minLevel, setMinLevel] = useState<number | undefined>(undefined);
  const [live, setLive] = useState(true);
  const dashboard = useSocDashboard(hours, minLevel, live);
  const status = useWazuhStatus();
  const fleetInfo = useSocFleet();
  const hosts = useSocHosts(hours);
  const serious = useSocSerious(hours, 10, live);
  const [open, setOpen] = useState<SocEvent | null>(null);
  const [, tick] = useState(0);
  const d = dashboard.data;

  // keep "vor x s" fresh between refreshes
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 5000);
    return () => clearInterval(timer);
  }, []);

  const manager = d?.fleet.manager;
  const highCritical = d ? d.severity.high + d.severity.critical : 0;
  const reviewCount = d ? (d.verdicts.review ?? 0) + (d.verdicts.suspicious ?? 0) + (d.verdicts.critical ?? 0) : 0;
  const verdictTotal = d ? Object.values(d.verdicts).reduce((sum, value) => sum + (value ?? 0), 0) : 0;
  const maxTimeline = useMemo(() => Math.max(1, ...(d?.timeline ?? []).map((bucket) => bucket.total)), [d]);
  const maxSerious = useMemo(() => Math.max(1, ...(d?.timeline ?? []).map((bucket) => bucket.serious)), [d]);
  // most relevant recent event: from the stream if it has something, otherwise the newest level-10+ event in the range
  const seriousEvents = useMemo(() => serious.data?.events ?? [], [serious.data]);
  const highlight = useMemo(() => {
    const pool = [...(d?.stream ?? []), ...seriousEvents];
    return pool.find((event) => event.assessment.verdict === 'critical') ?? pool.find((event) => event.assessment.verdict === 'suspicious') ?? pool.find((event) => event.assessment.verdict === 'review') ?? seriousEvents[0] ?? null;
  }, [d, seriousEvents]);
  // the highlight itself needs about 7 rows of 30 px; extra events only where space is left
  const moreSerious = seriousEvents.filter((event) => !highlight || eventKey(event) !== eventKey(highlight)).slice(0, Math.max(0, Math.min(4, highlightSpace - 8)));
  const hostColumns = 2;
  const hostList = (hosts.data ?? []).slice(0, hostRows * hostColumns);
  const osCounts = useMemo(() => {
    const counts = { windows: 0, linux: 0, other: 0 };
    (hosts.data ?? []).forEach((host) => {
      const Icon = platformIcon(host);
      if (Icon === Monitor) counts.windows += 1;
      else if (Icon === TerminalIcon) counts.linux += 1;
      else counts.other += 1;
    });
    return counts;
  }, [hosts.data]);

  return (
    <MotionConfig reducedMotion="user">
      <div ref={rootRef} className="flex flex-col gap-3" style={fitHeight ? { height: fitHeight } : undefined}>
        {/* compact header */}
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Live Security Dashboard</h1>
            <p className="text-[12px] text-muted">Wazuh-Events, regelbasierte Bewertung und Rechner auf einen Blick</p>
          </div>
          <div className="flex rounded-full border border-line/[0.12] p-1">
            {RANGES.map((range) => (
              <button key={range.hours} type="button" onClick={() => setHours(range.hours)} className={cn('relative h-7 rounded-full px-3 text-[12px]', hours === range.hours ? 'text-ink' : 'text-muted hover:text-ink')}>
                {hours === range.hours && <motion.span layoutId="soc-range" className="absolute inset-0 rounded-full border border-accent/30 bg-accent/[0.12]" />}
                <span className="relative">{range.label}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setLive(!live)} className={cn('flex h-9 items-center gap-2 rounded-full border px-3.5 text-[12px]', live ? 'border-ok/35 text-ok' : 'border-line/[0.12] text-muted')}>
            {live ? <><Beacon tone="ok" size={6} /> Live <Pause className="size-3.5" /></> : <><Play className="size-3.5" /> Pausiert</>}
          </button>
        </div>

        {/* KPIs */}
        <div className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi index={0} label={`Events · ${RANGES.find((range) => range.hours === hours)?.label}`} sub={d ? `${formatCount(d.severity.medium + d.severity.high + d.severity.critical)} ab Level 7` : undefined}>
            {d ? <AnimatedNumber value={d.total} /> : <Shimmer className="h-7 w-24" />}
          </Kpi>
          <Kpi index={1} label="Kritisch / Hoch" tone={highCritical ? 'bad' : undefined} sub={d ? 'Level 12–15 / 10–11' : undefined}>
            {d ? <span className={highCritical ? 'text-bad' : 'text-ok'}><AnimatedNumber value={d.severity.critical} /> / <AnimatedNumber value={d.severity.high} /></span> : <Shimmer className="h-7 w-16" />}
          </Kpi>
          <Kpi index={2} label="Rechner online" tone={manager?.disconnected ? 'warn' : undefined} sub={manager ? `${manager.disconnected} getrennt · ${manager.neverConnected} nie verbunden` : undefined}>
            {manager ? <span><span className="text-ok"><AnimatedNumber value={manager.active} /></span><span className="text-[16px] text-faint"> / {manager.total}</span></span> : d ? <AnimatedNumber value={d.activeHosts} /> : <Shimmer className="h-7 w-12" />}
          </Kpi>
          <Kpi index={3} label="Zu prüfen" tone={reviewCount ? 'warn' : undefined} sub={d ? `von ${d.stream.length} bewerteten Events` : undefined}>
            {d ? <span className={reviewCount ? 'text-accent' : ''}><AnimatedNumber value={reviewCount} /></span> : <Shimmer className="h-7 w-12" />}
          </Kpi>
          <Kpi index={4} label="Wazuh" tone={status.isError || fleetInfo.isError ? 'bad' : undefined} sub={status.data?.configured ? `Indexer ${status.data.latencyMs} ms${fleetInfo.data ? ` · Manager ${fleetInfo.data.version}` : ''}` : undefined}>
            <span className={cn('flex items-center gap-2 text-[20px]', status.isError ? 'text-bad' : 'text-ok')}>
              <Beacon tone={status.isError ? 'bad' : status.data?.configured ? 'ok' : 'muted'} size={8} /> {status.isError ? 'Fehler' : status.data?.configured ? 'verbunden' : '…'}
            </span>
          </Kpi>
          <Kpi index={5} label="Letztes Event" sub={ago(d?.lastEvent)}>
            <span className="font-mono text-[22px]">{d?.lastEvent ? new Date(d.lastEvent).toLocaleTimeString('de-DE') : '–'}</span>
          </Kpi>
        </div>

        {/* main area fills the rest */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(280px,0.75fr)]">
          <NotchCard index={6} eyebrow={live ? 'aktualisiert alle 15 s' : 'pausiert'} title="Live Event Stream" className="min-h-[360px]" bodyClassName="min-h-0 pt-2">
            <div className="mb-1.5 flex items-center gap-1.5">
              <div className="flex rounded-full border border-line/[0.10] p-0.5">
                {STREAM_LEVELS.map((entry) => (
                  <button key={entry.label} type="button" onClick={() => setMinLevel(entry.value)} className={cn('h-6 rounded-full px-2.5 text-[11.5px]', minLevel === entry.value ? 'bg-accent/[0.12] text-ink' : 'text-muted hover:text-ink')}>{entry.label}</button>
                ))}
              </div>
              <button type="button" onClick={() => navigate('/wazuh/investigation')} className="ml-auto flex items-center gap-1 text-[11.5px] text-muted hover:text-accent">Alle Events <ArrowRight className="size-3" /></button>
            </div>
            <div ref={streamRef} className="min-h-0 flex-1 overflow-hidden">
              {d ? (
                <ul>
                  <AnimatePresence initial={false}>
                    {d.stream.slice(0, streamRows).map((event) => <StreamRow key={eventKey(event)} event={event} onOpen={() => setOpen(event)} />)}
                  </AnimatePresence>
                </ul>
              ) : (
                <div className="space-y-1">{Array.from({ length: 10 }, (_, index) => <Shimmer key={index} className="h-7" />)}</div>
              )}
            </div>
          </NotchCard>

          <NotchCard
            index={7}
            eyebrow={hosts.data ? `${hosts.data.length} Rechner · ${osCounts.windows} Windows · ${osCounts.linux} Linux${osCounts.other ? ` · ${osCounts.other} sonstige` : ''}` : 'Rechner'}
            title="Rechner nach Risiko"
            className="min-h-[360px]"
            bodyClassName="min-h-0 pt-2"
          >
            {manager && (
              <div className="mb-2.5">
                <SplitBar height={6} parts={[{ value: manager.active, color: 'rgb(var(--ok))', label: 'online' }, { value: manager.disconnected, color: 'rgb(var(--bad))', label: 'getrennt' }, { value: manager.neverConnected, color: 'rgb(var(--line) / 0.2)', label: 'nie verbunden' }]} />
              </div>
            )}
            <div ref={hostsRef} className="min-h-0 flex-1 overflow-hidden">
              {hosts.data ? (
                <div className="grid grid-cols-2 gap-2">
                  <AnimatePresence>
                    {hostList.map((host, index) => <HostTile key={host.name} host={host} index={index} onOpen={() => navigate(`/wazuh/hosts?host=${encodeURIComponent(host.name)}`)} />)}
                  </AnimatePresence>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">{Array.from({ length: 8 }, (_, index) => <Shimmer key={index} className="h-[70px]" />)}</div>
              )}
            </div>
            <button type="button" onClick={() => navigate('/wazuh/hosts')} className="mt-1.5 flex items-center gap-1 self-end text-[11.5px] text-muted hover:text-accent">Alle Rechner <ArrowRight className="size-3" /></button>
          </NotchCard>

          <div className="flex min-h-0 flex-col gap-3">
            <NotchCard index={8} eyebrow="regelbasiert, keine KI" title="Wichtigstes Event" tone={highlight && ['critical', 'suspicious'].includes(highlight.assessment.verdict) ? 'bad' : highlight ? 'warn' : undefined} className="min-h-0 flex-1" bodyClassName="min-h-0 overflow-hidden pt-2.5">
              <div ref={highlightRef} className="flex min-h-0 flex-1 flex-col">
              <AnimatePresence mode="wait">
                {highlight ? (
                  <motion.button key={eventKey(highlight)} type="button" onClick={() => setOpen(highlight)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="flex min-h-0 shrink flex-col overflow-hidden text-left">
                    <span className="flex items-center gap-2"><VerdictBadge verdict={highlight.assessment.verdict} /><LevelPill level={highlight.rule.level} /><span className="ml-auto text-[11px] text-faint">{ago(highlight.timestamp)}</span></span>
                    <span className="mt-2 line-clamp-2 text-[14px] font-semibold leading-snug">{highlight.rule.description}</span>
                    <span className="mt-1 font-mono text-[11.5px] text-muted">{highlight.agent.name}{highlight.user ? ` · ${highlight.user}` : ''}{highlight.eventId ? ` · Event ${highlight.eventId}` : ''}</span>
                    <span className="mt-2 line-clamp-3 text-[12px] text-muted">{highlight.assessment.why}</span>
                    {highlight.assessment.nextSteps[0] && <span className="mt-1.5 line-clamp-1 text-[12px]"><span className="text-faint">Nächster Schritt: </span>{highlight.assessment.nextSteps[0]}</span>}
                    <span className="mt-2 flex items-center gap-1 text-[11.5px] text-accent">Details öffnen <ArrowRight className="size-3" /></span>
                  </motion.button>
                ) : d ? (
                  <motion.div key="calm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-[12.5px] text-muted">
                    <ShieldAlert className="size-7 text-ok" />
                    Keine Events ab Level 10 und nichts Auffälliges im Stream.
                  </motion.div>
                ) : <Shimmer className="h-40 w-full" />}
              </AnimatePresence>
              {!!moreSerious.length && (
                <div className="mt-auto border-t border-line/[0.07] pt-2">
                  <p className="mb-1 text-[10.5px] uppercase tracking-[0.08em] text-faint">Weitere ab Level 10</p>
                  <ul className="space-y-0.5">
                    {moreSerious.map((event) => (
                      <li key={eventKey(event)}>
                        <button type="button" onClick={() => setOpen(event)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[11.5px] hover:bg-hover/60">
                          <LevelPill level={event.rule.level} />
                          <span className="min-w-0 flex-1 truncate">{event.rule.description}</span>
                          <span className="shrink-0 font-mono text-[10.5px] text-faint">{event.agent.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              </div>
            </NotchCard>

            <NotchCard index={9} eyebrow={`Bewertung der neuesten ${d?.stream.length ?? 0} · Schwere ${RANGES.find((range) => range.hours === hours)?.label}`} title="Lage" className="shrink-0" bodyClassName="gap-3 pt-2.5">
              {d && verdictTotal ? (
                <>
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-line/[0.08]">
                    {VERDICT_ORDER.map((verdict) => (
                      <motion.span key={verdict} style={{ background: VERDICT_COLOR[verdict] }} initial={{ width: 0 }} animate={{ width: `${((d.verdicts[verdict] ?? 0) / verdictTotal) * 100}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
                    ))}
                  </div>
                  <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1">
                    {VERDICT_ORDER.map((verdict) => (
                      <li key={verdict} className="flex items-center gap-2 text-[11.5px]">
                        <span className="size-2 rounded-full" style={{ background: VERDICT_COLOR[verdict] }} />
                        <span className="truncate text-muted">{VERDICT[verdict].label}</span>
                        <span className="ml-auto font-mono">{d.verdicts[verdict] ?? 0}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : <Shimmer className="h-16 w-full" />}
              <div>
              {d ? (
                <div className="grid grid-cols-4 gap-2 text-center">
                  {([
                    ['Niedrig', d.severity.low, 'text-muted'],
                    ['Mittel', d.severity.medium, 'text-ink'],
                    ['Hoch', d.severity.high, d.severity.high ? 'text-accent' : 'text-muted'],
                    ['Kritisch', d.severity.critical, d.severity.critical ? 'text-bad' : 'text-muted'],
                  ] as const).map(([label, value, tone]) => (
                    <div key={label} className="rounded-xl border border-line/[0.07] py-1.5">
                      <p className={cn('truncate px-1 text-[14px] font-bold', tone)} title={value.toLocaleString('de-DE')}>{value >= 100_000 ? formatCount(value) : <AnimatedNumber value={value} />}</p>
                      <p className="text-[10.5px] text-faint">{label}</p>
                    </div>
                  ))}
                </div>
              ) : <Shimmer className="h-12 w-full" />}
              </div>
            </NotchCard>
          </div>
        </div>

        {/* timeline strip: grey = all events, accent = from level 7 */}
        <div className="flex h-11 shrink-0 items-end gap-px px-1" aria-hidden="true">
          {(d?.timeline ?? []).map((bucket, index) => (
            <span key={bucket.time} className="relative flex h-full flex-1 flex-col justify-end" title={`${new Date(bucket.time * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}: ${bucket.total} Events, ${bucket.serious} ab Level 7`}>
              {bucket.serious > 0 && <motion.span className="mb-px block rounded-sm bg-accent" initial={{ height: 0 }} animate={{ height: `${Math.max(8, (bucket.serious / maxSerious) * 40)}%` }} transition={{ duration: 0.6, delay: index * 0.008 }} />}
              <motion.span className="block rounded-t-sm bg-line/[0.16]" initial={{ height: 0 }} animate={{ height: `${Math.max(4, (bucket.total / maxTimeline) * 55)}%` }} transition={{ duration: 0.6, delay: index * 0.008 }} />
            </span>
          ))}
        </div>
      </div>

      <EventDrawer event={open} onClose={() => setOpen(null)} />
    </MotionConfig>
  );
}
