import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpRight,
  Bell,
  Bot,
  CalendarDays,
  ChevronDown,
  Code2,
  Container,
  Monitor,
  Play,
  RefreshCw,
  ScrollText,
  SquareTerminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { API_CONFIG } from '@/services/api-config';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { AnimatedNumber, AreaLine, LoadSlider, Orb, PillBars, Ring, Trend } from '@/components/ui/viz';
import { formatClock, formatRelative, parseBackendDate } from '@/lib/format';
import { formatBytes, proxmoxStats } from '@/lib/proxmox';
import {
  normalizeHostAlert,
  useAgentAlerts,
  useAgents,
  useAuditLogs,
  useConnections,
  useDockerContainers,
  useFleetMetrics,
  useHostAlerts,
  useRecentJobs,
  useProxmoxSummary,
  useScripts,
  type HostAlert,
  type RawHostAlert,
} from '@/hooks/use-infrastructure';

const RANGES = [
  { label: 'Letzte Stunde', hours: 1, short: '1 h' },
  { label: 'Letzte 24 Stunden', hours: 24, short: '24 h' },
  { label: 'Letzte 7 Tage', hours: 24 * 7, short: '7 Tage' },
  { label: 'Letzter Monat', hours: 24 * 30, short: '1 Monat' },
  { label: 'Letztes Jahr', hours: 24 * 365, short: '1 Jahr' },
];

/* ---------- small building blocks ---------- */

function OutlinePill({ children, onClick, active }: { children: ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-10 items-center gap-2 rounded-full border px-4 text-[13.5px] transition-all duration-200 ease-out active:scale-[0.97]',
        active ? 'border-accent/40 bg-accent/10 text-ink' : 'border-line/[0.12] bg-transparent text-ink/90 hover:border-accent/35 hover:bg-raised',
      )}
    >
      {children}
    </button>
  );
}

function RangeMenu({ hours, onChange }: { hours: number; onChange: (hours: number) => void }) {
  const [open, setOpen] = useState(false);
  const current = RANGES.find((range) => range.hours === hours) ?? RANGES[0];
  return (
    <div className="relative">
      <OutlinePill onClick={() => setOpen((value) => !value)} active={open}>
        <CalendarDays className="size-4 text-muted" />
        {current.label}
        <ChevronDown className={cn('size-4 text-muted transition-transform duration-200', open && 'rotate-180')} />
      </OutlinePill>
      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="panel-surface absolute right-0 top-12 z-20 w-52 overflow-hidden rounded-2xl p-1.5 shadow-2xl"
            role="listbox"
          >
            {RANGES.map((range) => (
              <li key={range.hours}>
                <button
                  type="button"
                  role="option"
                  aria-selected={range.hours === hours}
                  onClick={() => {
                    onChange(range.hours);
                    setOpen(false);
                  }}
                  className={cn('flex h-9 w-full items-center rounded-xl px-3 text-left text-[13px] transition-colors hover:bg-hover', range.hours === hours ? 'text-accent' : 'text-ink/85')}
                >
                  {range.label}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-[12px] text-muted">{label}</p>
      <p className="mt-1 text-[18px] font-semibold tabular">{value}</p>
    </div>
  );
}

function MiniMeter({ label, value, delay = 0 }: { label: string; value: number | null; delay?: number }) {
  const tone = value === null ? '' : value >= 90 ? 'from-bad/70 to-bad' : value >= 75 ? 'from-warn/60 to-warn' : 'from-accent/60 to-accent';
  return (
    <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-faint">
      <span className="w-7">{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-line/[0.07]">
        <motion.div
          className={cn('h-full rounded-full bg-gradient-to-r', tone)}
          initial={{ width: 0 }}
          animate={{ width: `${value ?? 0}%` }}
          transition={{ duration: 1, delay: 0.4 + delay, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <span className="w-8 text-right font-mono tabular text-ink/75">{value === null ? '–' : `${Math.round(value)}%`}</span>
    </div>
  );
}

function ProxmoxOffline({ error, onNavigate }: { error?: string; onNavigate: (path: string) => void }) {
  const missingToken = !!error && /credential|token/i.test(error);
  return (
    <div className="flex flex-1 flex-col justify-center gap-2 py-4">
      <p className="flex items-center gap-2 text-[15px] font-semibold">
        <StatusDot tone="bad" /> Proxmox nicht verbunden
      </p>
      <p className="max-w-[520px] text-[13px] text-muted">
        {missingToken
          ? 'Das Backend kennt noch keinen API-Token. Nach dem Eintragen in backend/.env muss das Backend einmal neu gestartet werden.'
          : error ?? 'Die Proxmox-API antwortet nicht.'}
      </p>
      <button type="button" onClick={() => onNavigate('/settings')} className="mt-1 self-start text-[13px] text-accent hover:underline">
        Proxmox-Adresse prüfen →
      </button>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center py-6 text-center text-[13px] text-muted">{children}</div>;
}

function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'bad' | 'run' }) {
  return (
    <span className="relative flex size-2.5 shrink-0 items-center justify-center">
      {tone === 'ok' && <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok/40 [animation-duration:2.4s]" />}
      <span className={cn('relative size-2 rounded-full', { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', run: 'bg-accent animate-pulse' }[tone])} />
    </span>
  );
}

/* ---------- 7-day alert history ---------- */

function useWeekAlerts() {
  return useQuery<HostAlert[]>({
    queryKey: ['infra', 'host-alerts-recent', 168],
    queryFn: async () => {
      const response = await fetch(`${API_CONFIG.baseURL}/connections/alerts/recent?hours=168`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return ((await response.json()) as RawHostAlert[]).map(normalizeHostAlert);
    },
    refetchInterval: 60_000,
  });
}

const WEEKDAY = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });

/* ---------- page ---------- */

export function Dashboard({ onNavigate }: { onNavigate: (path: string) => void }) {
  const queryClient = useQueryClient();
  const [hours, setHours] = useState(24);
  const fleet = useFleetMetrics(hours);
  const connections = useConnections();
  const agents = useAgents();
  const docker = useDockerContainers();
  const hostAlerts = useHostAlerts();
  const agentAlerts = useAgentAlerts();
  const weekAlerts = useWeekAlerts();
  const audit = useAuditLogs(5);
  const jobs = useRecentJobs(4);
  const scripts = useScripts();

  const proxmox = useProxmoxSummary();
  const pve = proxmoxStats(proxmox.data);
  const topGuests = useMemo(
    () =>
      [...(pve?.guests ?? [])]
        .sort((left, right) => (right.status === 'running' ? (right.cpu ?? 0) : -1) - (left.status === 'running' ? (left.cpu ?? 0) : -1))
        .slice(0, 6),
    [pve?.guests],
  );

  const hosts = connections.data ?? [];
  const sshHosts = hosts.filter((host) => host.type !== 'rdp');
  const ssh = sshHosts.length;
  const sshOnline = sshHosts.filter((host) => host.status === 'online').length;
  const containers = docker.data ?? [];
  const running = containers.filter((container) => container.status === 'running').length;
  const agentList = agents.data ?? [];
  const agentsOnline = agentList.filter((agent) => agent.status === 'online').length;
  const activeAlerts = (hostAlerts.data?.length ?? 0) + (agentAlerts.data?.length ?? 0);

  const cpuSeries = fleet.data.buckets.map((bucket) => bucket.cpu);
  const memorySeries = fleet.data.buckets.map((bucket) => bucket.memory);
  const average = (values: Array<number | null>) => {
    const present = values.filter((value): value is number => value !== null);
    return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
  };
  const cpuAverage = average(cpuSeries);
  const memoryAverage = average(memorySeries);
  const cpuNow = fleet.data.latest.cpu;


  const week = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (6 - index));
      return { start: date.getTime(), label: WEEKDAY.format(date).replace('.', ''), count: 0, critical: 0 };
    });
    (weekAlerts.data ?? []).forEach((alert) => {
      const time = parseBackendDate(alert.created_at)?.getTime();
      if (!time) return;
      const day = [...days].reverse().find((entry) => time >= entry.start);
      if (!day) return;
      day.count += 1;
      if (alert.severity === 'critical') day.critical += 1;
    });
    const peak = Math.max(...days.map((day) => day.count));
    return { days, peak, total: days.reduce((sum, day) => sum + day.count, 0), critical: days.reduce((sum, day) => sum + day.critical, 0) };
  }, [weekAlerts.data]);

  const rangeLabel = RANGES.find((range) => range.hours === hours)?.short ?? `${hours} h`;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Behalte deine Infrastruktur im Blick und greife direkt ein"
        actions={
          <>
            <RangeMenu hours={hours} onChange={setHours} />
            <OutlinePill onClick={() => queryClient.invalidateQueries({ queryKey: ['infra'] })}>
              <RefreshCw className={cn('size-4', (fleet.loading || connections.isFetching) && 'animate-spin')} /> Aktualisieren
            </OutlinePill>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-6 2xl:grid-cols-12">
        {/* Infrastructure: Proxmox cluster */}
        <NotchCard
          index={0}
          glow
          className="min-h-[300px] lg:col-span-6 2xl:col-span-6"
          eyebrow="Proxmox-Cluster"
          title="Infrastruktur"
          actions={[
            { label: 'Alerts anzeigen', icon: <Bell />, onClick: () => onNavigate('/alerts'), badge: activeAlerts > 0 },
            { label: 'Proxmox öffnen', icon: <ArrowUpRight />, onClick: () => onNavigate('/proxmox') },
          ]}
        >
          {proxmox.isLoading ? (
            <Empty>Verbinde mit Proxmox …</Empty>
          ) : !pve ? (
            <ProxmoxOffline error={proxmox.data?.error ?? (proxmox.error as Error | null)?.message} onNavigate={onNavigate} />
          ) : (
            <div className="flex flex-1 items-center gap-6">
              <div className="min-w-0 flex-1">
                <div className="mt-4 flex flex-wrap items-end gap-x-10 gap-y-4">
                  <div>
                    <AnimatedNumber value={pve.guests.length} className="block text-[64px] font-bold leading-none tracking-[-0.04em]" />
                    <p className="mt-2 text-[13px] text-muted">Virtuelle Systeme</p>
                  </div>
                  <div className="flex gap-7 pb-6">
                    <Stat label="Running" value={<span className="text-ok"><AnimatedNumber value={pve.running} /></span>} />
                    <Stat label="Stopped" value={<AnimatedNumber value={pve.stopped} />} />
                    <Stat label="VMs" value={<AnimatedNumber value={pve.qemu} />} />
                    <Stat label="LXC" value={<AnimatedNumber value={pve.lxc} />} />
                  </div>
                </div>
                <div className="mt-5 flex items-center gap-2.5 text-[13px]">
                  <span className="font-semibold tabular">{pve.nodesOnline} / {pve.nodesTotal}</span>
                  <span className="text-muted">Proxmox-Nodes</span>
                  <span className={cn('ml-1 flex items-center gap-1.5', pve.healthy ? 'text-ok' : 'text-warn')}>
                    <StatusDot tone={pve.healthy ? 'ok' : 'warn'} />
                    {pve.healthy ? 'Cluster healthy' : 'Node offline'}
                  </span>
                </div>
                <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-3">
                  {pve.nodes.map((node, index) => (
                    <li key={node.node} className="min-w-0">
                      <p className="flex items-center gap-2 truncate font-mono text-[12px] text-ink/90">
                        <span className={cn('size-1.5 rounded-full', node.status === 'online' ? 'bg-ok' : 'bg-bad')} />
                        {node.node}
                      </p>
                      <MiniMeter label="CPU" value={node.cpuPercent} delay={index * 0.08} />
                      <MiniMeter label="RAM" value={node.memoryPercent} delay={0.1 + index * 0.08} />
                    </li>
                  ))}
                </ul>
              </div>
              <Orb size={170} className="hidden xl:block" />
            </div>
          )}
        </NotchCard>

        {/* Remote access: SSH / RDP connections, separate from Proxmox guests */}
        <NotchCard
          index={1}
          className="min-h-[300px] lg:col-span-3 2xl:col-span-3"
          eyebrow="Remote Access"
          title="SSH-Hosts"
          actions={[
            { label: 'Terminal öffnen', icon: <SquareTerminal />, onClick: () => onNavigate('/terminal') },
            { label: 'Alle Verbindungen', icon: <ArrowUpRight />, onClick: () => onNavigate('/systems') },
          ]}
        >
          <p className="mt-4 text-[44px] font-bold leading-none tracking-[-0.03em]">
            <AnimatedNumber value={connections.data ? ssh : null} />
          </p>
          <p className="mt-3 text-[13px] text-muted">
            <span className="font-medium text-ok">{sshOnline} online</span> · {hosts.length - ssh} RDP
          </p>
          <ul className="mt-auto space-y-1 pt-4">
            {hosts.slice(0, 3).map((host) => {
              const hasAlert = (hostAlerts.data ?? []).some((alert) => alert.connection_id === host.id);
              return (
                <li key={host.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(`/systems?host=${encodeURIComponent(host.id)}`)}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-hover/60"
                  >
                    <StatusDot tone={host.status !== 'online' ? 'bad' : hasAlert ? 'warn' : 'ok'} />
                    <span className="flex-1 truncate text-[13px]">{host.name}</span>
                    <span className="font-mono text-[11px] text-faint">{host.type === 'rdp' ? 'RDP' : 'SSH'}</span>
                  </button>
                </li>
              );
            })}
            {hosts.length === 0 && <li className="text-[13px] text-muted">Noch keine Verbindungen angelegt.</li>}
          </ul>
        </NotchCard>


        {/* Alerts this week */}
        <NotchCard
          index={2}
          className="min-h-[300px] lg:col-span-3 2xl:col-span-3"
          eyebrow="Alerts · letzte 7 Tage"
          title="Warnungen"
          actions={[{ label: 'Alerts öffnen', icon: <Bell />, onClick: () => onNavigate('/alerts'), badge: activeAlerts > 0 }]}
        >
          <p className="mt-4 text-[44px] font-bold leading-none tracking-[-0.03em]">
            <AnimatedNumber value={weekAlerts.data ? week.total : null} />
          </p>
          <p className="mt-3 text-[13px] text-muted">
            <span className={week.critical > 0 ? 'font-medium text-accent' : undefined}>{week.critical} kritisch</span> · {activeAlerts} offen
          </p>
          <div className="mt-auto pt-5">
            <PillBars
              height={74}
              bars={week.days.map((day) => ({
                label: day.label,
                value: day.count,
                highlight: week.peak > 0 && day.count === week.peak,
                title: `${day.count} Alerts`,
              }))}
            />
          </div>
        </NotchCard>

        {/* Cluster resources from Proxmox */}
        <NotchCard
          index={4}
          className="min-h-[250px] lg:col-span-3 2xl:col-span-3"
          eyebrow="Proxmox-Cluster"
          title="RAM-Auslastung"
          actions={[{ label: 'Proxmox öffnen', icon: <ArrowUpRight />, onClick: () => onNavigate('/proxmox') }]}
        >
          {!pve || pve.memory === null ? (
            <Empty>{proxmox.isLoading ? 'Lädt …' : 'Keine Cluster-Daten.'}</Empty>
          ) : (
            <>
              <p className="mt-4 text-[44px] font-bold leading-none tracking-[-0.03em]">
                <AnimatedNumber value={pve.memory} /><span className="ml-1 text-[22px] text-muted">%</span>
              </p>
              <p className="mt-3 text-[13px] text-muted">
                {formatBytes(pve.memoryUsed)} von {formatBytes(pve.memoryTotal)} · CPU {pve.cpu === null ? '–' : `${Math.round(pve.cpu)} %`}
              </p>
              <div className="mt-auto pt-5">
                <LoadSlider value={pve.memory} ticks={['0 %', '25 %', '50 %', '75 %', '100 %']} />
              </div>
            </>
          )}
        </NotchCard>


        {/* CPU now */}
        <NotchCard
          index={5}
          className="min-h-[250px] lg:col-span-3 2xl:col-span-3"
          eyebrow="SSH-Metriken · jetzt"
          title="Ø CPU-Last"
          actions={[{ label: 'Monitoring öffnen', icon: <ArrowUpRight />, onClick: () => onNavigate('/monitoring') }]}
        >
          <p className="mt-4 text-[44px] font-bold leading-none tracking-[-0.03em]">
            {cpuNow === null ? '–' : <><AnimatedNumber value={cpuNow} /><span className="ml-1 text-[22px] text-muted">%</span></>}
          </p>
          <p className="mt-3 flex items-center gap-1.5 text-[13px] text-muted">
            <Trend value={cpuNow !== null && cpuAverage !== null ? cpuNow - cpuAverage : null} suffix=" Pkt." goodWhenUp={false} />
            ggü. Ø {rangeLabel}
          </p>
          <AreaLine values={cpuSeries} height={70} className="mt-auto pt-4" />
        </NotchCard>

        {/* Agents */}
        <NotchCard
          index={6}
          className="min-h-[250px] lg:col-span-3 2xl:col-span-3"
          eyebrow="Verbunden"
          title="Agents"
          actions={[{ label: 'Agents verwalten', icon: <Bot />, onClick: () => onNavigate('/agents') }]}
        >
          {agents.data && agentList.length === 0 ? (
            <Empty>
              <span>
                Noch keine Agents installiert.
                <button type="button" onClick={() => onNavigate('/agents')} className="mt-2 block w-full text-accent hover:underline">Agent hinzufügen →</button>
              </span>
            </Empty>
          ) : (
            <div className="flex flex-1 items-center gap-6 pt-3">
              <Ring value={agentList.length ? (agentsOnline / agentList.length) * 100 : null}>
                <span className="text-[26px] font-bold tabular">{agentList.length ? `${Math.round((agentsOnline / agentList.length) * 100)}%` : '–'}</span>
              </Ring>
              <div>
                <p className="text-[34px] font-bold leading-none tabular">{agentsOnline}</p>
                <p className="mt-1.5 text-[13px] text-muted">von {agentList.length} online</p>
              </div>
            </div>
          )}
        </NotchCard>

        {/* Containers */}
        <NotchCard
          index={7}
          className="min-h-[250px] lg:col-span-3 2xl:col-span-3"
          eyebrow="Docker-Hosts"
          title="Docker-Container"
          actions={[{ label: 'Container öffnen', icon: <Container />, onClick: () => onNavigate('/containers') }]}
        >
          {docker.isError ? (
            <Empty>Docker-Hosts nicht erreichbar.</Empty>
          ) : (
            <div className="flex flex-1 items-center justify-center pt-3">
              <Ring value={containers.length ? (running / containers.length) * 100 : null} size={140}>
                <span className="text-[28px] font-bold leading-none tabular">{containers.length ? <AnimatedNumber value={running} /> : '–'}</span>
                <span className="mt-1 text-[12px] text-muted">von {containers.length}</span>
              </Ring>
            </div>
          )}
        </NotchCard>

        {/* Events */}
        <NotchCard
          index={8}
          className="min-h-[300px] lg:col-span-3 2xl:col-span-4"
          eyebrow="Audit-Log"
          title="Letzte Ereignisse"
          actions={[{ label: 'Audit-Log öffnen', icon: <ScrollText />, onClick: () => onNavigate('/audit') }]}
        >
          {!audit.data?.length ? (
            <Empty>{audit.isLoading ? 'Lädt …' : 'Noch keine Ereignisse.'}</Empty>
          ) : (
            <ol className="relative mt-4 space-y-4">
              <span className="absolute bottom-2 left-[4px] top-2 w-px bg-gradient-to-b from-accent/50 via-line/10 to-transparent" aria-hidden="true" />
              {audit.data.map((log, index) => (
                <motion.li
                  key={log.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + index * 0.06 }}
                  className="relative flex gap-3.5"
                >
                  <span className={cn('relative mt-1.5 size-[9px] shrink-0 rounded-full ring-4 ring-card', log.status === 'failed' ? 'bg-bad' : 'bg-accent')} />
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium">{log.action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (char) => char.toUpperCase())}</p>
                    <p className="truncate font-mono text-[11.5px] text-muted">{[log.user, log.target].filter(Boolean).join(' → ')}</p>
                  </div>
                  <span className="ml-auto shrink-0 text-[11.5px] text-faint">{formatRelative(log.timestamp)}</span>
                </motion.li>
              ))}
            </ol>
          )}
        </NotchCard>

        {/* Jobs */}
        <NotchCard
          index={10}
          className="min-h-[300px] lg:col-span-3 2xl:col-span-4"
          eyebrow="Automatisierung"
          title="Letzte Jobs"
          actions={[{ label: 'Scripts öffnen', icon: <Code2 />, onClick: () => onNavigate('/scripts') }]}
        >
          {jobs.data?.length ? (
            <ul className="mt-3 space-y-1">
              {jobs.data.map((job) => (
                <li key={job.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-hover/60">
                  <StatusDot tone={job.status === 'success' ? 'ok' : job.status === 'running' ? 'run' : 'bad'} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">{job.title}</p>
                    <p className="truncate font-mono text-[11.5px] text-muted">{job.target}</p>
                  </div>
                  <span className="font-mono text-[11.5px] text-faint">{formatClock(job.startedAt)}</span>
                </li>
              ))}
            </ul>
          ) : scripts.data?.length ? (
            <ul className="mt-3 space-y-1">
              <p className="px-2 pb-1 text-[12px] text-muted">Noch keine Ausführungen. Bereit zum Start:</p>
              {scripts.data.slice(0, 4).map((script) => (
                <li key={script.id}>
                  <button type="button" onClick={() => onNavigate('/scripts')} className="group flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-hover/60">
                    <Play className="size-4 text-muted transition-colors group-hover:text-accent" />
                    <span className="flex-1 truncate text-[13.5px]">{script.name}</span>
                    <span className="font-mono text-[11px] text-faint">{script.type}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>
              <span>
                Noch keine Jobs und keine Scripts.
                <button type="button" onClick={() => onNavigate('/scripts')} className="mt-2 block w-full text-accent hover:underline">Script anlegen →</button>
              </span>
            </Empty>
          )}
        </NotchCard>

        {/* Proxmox guests */}
        <NotchCard
          index={11}
          className="min-h-[300px] lg:col-span-6 2xl:col-span-4"
          eyebrow="Proxmox-Cluster"
          title="Gäste nach CPU-Last"
          actions={[{ label: 'Proxmox öffnen', icon: <ArrowUpRight />, onClick: () => onNavigate('/proxmox') }]}
        >
          {!pve ? (
            <Empty>{proxmox.isLoading ? 'Lädt …' : 'Proxmox nicht verbunden.'}</Empty>
          ) : (
            <ul className="mt-3 space-y-1">
              {topGuests.map((guest, index) => {
                const cpu = guest.status === 'running' && typeof guest.cpu === 'number' ? guest.cpu * 100 : null;
                return (
                  <li key={`${guest.node}-${guest.vmid}`} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-hover/60">
                    <StatusDot tone={guest.status === 'running' ? 'ok' : 'bad'} />
                    <span className="w-9 shrink-0 rounded-md bg-hover px-1.5 py-0.5 text-center font-mono text-[10.5px] text-muted">{guest.type === 'lxc' ? 'CT' : 'VM'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium">{guest.name ?? `#${guest.vmid}`}</p>
                      <p className="truncate font-mono text-[11.5px] text-muted">{guest.vmid} · {guest.node}</p>
                    </div>
                    <div className="flex w-[110px] items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line/[0.07]">
                        <motion.div
                          className="h-full rounded-full bg-gradient-to-r from-accent/70 to-accent"
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, cpu ?? 0)}%` }}
                          transition={{ duration: 1, delay: 0.5 + index * 0.06, ease: [0.22, 1, 0.36, 1] }}
                        />
                      </div>
                      <span className="w-9 text-right font-mono text-[11.5px] tabular text-ink/80">{cpu === null ? '–' : `${Math.round(cpu)}%`}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </NotchCard>
      </div>
    </>
  );
}
