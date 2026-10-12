import { useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MotionConfig, motion } from 'motion/react';
import {
  ArrowLeft,
  BrickWall,
  Container,
  FolderOpen,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  Monitor,
  MonitorPlay,
  Network,
  RefreshCw,
  ShieldHalf,
  SquareTerminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NotchCard } from '@/components/ui/NotchCard';
import { AnimatedNumber, Ring } from '@/components/ui/viz';
import { TimeChart } from '@/components/ui/TimeChart';
import { TimeframeSwitch } from '@/components/proxmox/shared';
import { FindingRow } from '@/components/security/FindingList';
import { WazuhCard } from '@/components/systems/WazuhCard';
import { SarAgentCard } from '@/components/systems/SarAgentCard';
import { WazuhEventsCard } from '@/components/wazuh/WazuhEventsCard';
import { Beacon, FillBar, Gauge, LiveSpark, ScanOverlay, Shimmer, SplitBar, Stagger } from '@/components/systems/fx';
import { staggerChild, useLiveSeries } from '@/lib/fx';
import { useConnections } from '@/hooks/use-infrastructure';
import { guestId, useGuestNetworks } from '@/hooks/use-network';
import { useGuestRrd, useGuestStatus } from '@/hooks/use-proxmox';
import { useHardeningAudit, useSystemFacts } from '@/hooks/use-hardening';
import { useRdpLaunch } from '@/hooks/use-rdp';
import type { Timeframe } from '@/services/proxmox';
import { formatBytes } from '@/lib/proxmox';
import { formatUptime } from '@/lib/usage';
import { formatRelative } from '@/lib/format';
import { scoreTone, SEVERITY_RANK } from '@/lib/hardening';
import { PORT_NAMES } from '@/lib/net';

const EASE = [0.22, 1, 0.36, 1] as const;

function Row({ label, children, mono, loading }: { label: string; children: ReactNode; mono?: boolean; loading?: boolean }) {
  return (
    <motion.div variants={staggerChild} className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-[12px] text-muted">{label}</dt>
      <dd className={cn('min-w-0 truncate text-right text-[12.5px]', mono && 'font-mono text-[12px]')}>{loading ? <Shimmer className="ml-auto h-3 w-28" /> : children}</dd>
    </motion.div>
  );
}

const percent = (value: number) => `${Math.round(value)} %`;
const isLoopback = (address: string) => address.startsWith('127.') || address === '::1';

/** Slow drifting light behind the header */
function Aurora({ tone }: { tone: 'ok' | 'bad' | 'muted' }) {
  const color = tone === 'ok' ? 'var(--accent)' : tone === 'bad' ? 'var(--bad)' : 'var(--faint)';
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[26px]" aria-hidden="true">
      <motion.div
        className="absolute -left-20 -top-24 size-[340px] rounded-full blur-3xl"
        style={{ background: `rgb(${color} / 0.16)` }}
        animate={{ x: [0, 120, 0], y: [0, 30, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-32 right-10 size-[300px] rounded-full blur-3xl"
        style={{ background: 'rgb(var(--info) / 0.08)' }}
        animate={{ x: [0, -100, 0], y: [0, -20, 0] }}
        transition={{ duration: 19, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="grid-texture absolute inset-0 opacity-60" />
    </div>
  );
}

export function SystemDetailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // Read the id once: while the page animates out after navigating away, the location already
  // points elsewhere, and re-rendering with it would swap the content and stall the page transition
  const [id] = useState(() => decodeURIComponent(location.pathname.split('/')[2] ?? ''));
  const connections = useConnections();
  const guests = useGuestNetworks();
  const audit = useHardeningAudit();
  const rdp = useRdpLaunch();
  const [timeframe, setTimeframe] = useState<Timeframe>('day');

  const connection = connections.data?.find((entry) => entry.id === id);
  const ssh = connection ? connection.type !== 'rdp' : false;
  const guest = useMemo(() => {
    if (!connection) return undefined;
    const list = guests.data ?? [];
    return list.find((entry) => entry.ips.includes(connection.host)) ?? list.find((entry) => !!entry.name && entry.name.toLowerCase() === connection.name.toLowerCase());
  }, [connection, guests.data]);
  const guestRef = guest ? { node: guest.node, type: guest.type, vmid: guest.vmid } : null;
  const status = useGuestStatus(guestRef);
  const rrd = useGuestRrd(guestRef, timeframe);
  const facts = useSystemFacts(ssh && (!guest || guest.status === 'running') ? connection?.id : undefined);

  const live = status.data;
  const running = (live?.status ?? guest?.status) === 'running';
  const cpu = running && typeof live?.cpu === 'number' ? live.cpu * 100 : null;
  const memory = running && live?.maxmem ? ((live.mem ?? 0) / live.maxmem) * 100 : null;
  // Proxmox status is polled every 5 s: collect it into a live line
  const cpuSeries = useLiveSeries(cpu === null ? null : Math.round(cpu * 10) / 10);

  const audited = audit.data?.last?.guests.find((entry) => (guest ? entry.key === `vm:${guest.vmid}` : entry.key === `conn:${id}`));
  const problems = (audited?.findings ?? []).filter((finding) => finding.status === 'fail' || finding.status === 'warn').sort((a, b) => (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1) || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  if (connections.isLoading) return <p className="flex items-center justify-center py-24 text-muted"><Loader2 className="mr-2 size-4 animate-spin" /> Lädt …</p>;
  if (!connection) {
    return (
      <div className="py-24 text-center">
        <p className="text-[15px] font-medium">System nicht gefunden</p>
        <button type="button" onClick={() => navigate('/systems')} className="mt-3 text-[13px] text-accent hover:underline">Zurück zu Systeme</button>
      </div>
    );
  }

  const chartData = (rrd.data ?? []).map((point) => ({
    time: point.time,
    cpu: typeof point.cpu === 'number' ? point.cpu * 100 : null,
    mem: point.maxmem ? ((point.mem ?? 0) / point.maxmem) * 100 : null,
  }));
  const f = facts.data;
  const loadingFacts = ssh && facts.isLoading;
  const security = f ? f.upgradable.filter((entry) => entry.security).length : 0;
  const external = f ? [...new Map(f.listening.filter((entry) => !isLoopback(entry.address)).map((entry) => [`${entry.proto}/${entry.port}`, entry])).values()].sort((a, b) => a.port - b.port) : [];
  const isWazuhServer = !!f?.docker?.some((container) => /wazuh\.manager|wazuh-manager/.test(container.name));
  const raw = connection as { authType?: string; auth_type?: string };
  const authKey = (raw.auth_type ?? raw.authType) === 'key';
  const onlineTone = connection.status === 'online' ? 'ok' : connection.status === 'offline' ? 'bad' : 'muted';

  const actions = [
    ...(ssh
      ? [
          { label: 'Terminal', icon: SquareTerminal, onClick: () => navigate(`/terminal?host=${encodeURIComponent(connection.id)}`) },
          { label: 'Dateien', icon: FolderOpen, onClick: () => navigate(`/files?host=${encodeURIComponent(connection.id)}`) },
        ]
      : [{ label: 'Per RDP verbinden', icon: MonitorPlay, onClick: () => rdp.mutate({ id: connection.id, name: connection.name }), primary: true }]),
    ...(guest
      ? [
          { label: 'Netzwerk', icon: Network, onClick: () => navigate(`/network?guest=${encodeURIComponent(guestId(guest))}`) },
          { label: 'Firewall', icon: BrickWall, onClick: () => navigate(`/firewall?guest=${encodeURIComponent(guestId(guest))}`) },
          { label: 'Proxmox', icon: Layers, onClick: () => navigate('/proxmox') },
        ]
      : []),
    { label: 'Security', icon: ShieldHalf, onClick: () => navigate(`/security?guest=${encodeURIComponent(guest ? `vm:${guest.vmid}` : `conn:${connection.id}`)}`) },
  ];

  return (
    <MotionConfig reducedMotion="user">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="panel-surface relative mb-5 overflow-hidden rounded-[26px] px-6 pb-5 pt-4"
      >
        <Aurora tone={onlineTone} />
        <div className="relative">
          <button type="button" onClick={() => navigate('/systems')} className="group mb-3 flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink">
            <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" /> Systeme
          </button>
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div className="flex min-w-0 items-center gap-4">
              <motion.div
                initial={{ scale: 0.6, opacity: 0, rotate: -20 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
                className="relative flex size-14 shrink-0 items-center justify-center rounded-2xl border border-line/[0.12] bg-raised shadow-[0_12px_30px_-12px_rgb(var(--accent)/0.6)]"
              >
                {guest?.type === 'lxc' ? <Container className="size-6 text-accent" /> : ssh ? <SquareTerminal className="size-6 text-accent" /> : <Monitor className="size-6 text-accent" />}
                <span className="absolute -bottom-1 -right-1"><Beacon tone={onlineTone} size={9} /></span>
              </motion.div>
              <div className="min-w-0">
                <motion.p initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15, duration: 0.4 }} className="text-[12.5px] text-muted">
                  {ssh ? 'SSH' : 'RDP'}
                  {guest && ` · ${guest.type === 'lxc' ? 'Container' : 'VM'} ${guest.vmid} · ${guest.node}`}
                  {f?.os.pretty && ` · ${f.os.pretty}`}
                </motion.p>
                <motion.h1 initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ delay: 0.2, duration: 0.5, ease: EASE }} className="truncate text-[32px] font-semibold tracking-[-0.03em]">
                  {connection.name}
                </motion.h1>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12.5px] text-muted">
                  <span>{connection.username}@{connection.host}:{connection.port}</span>
                  <span className={cn('font-sans', onlineTone === 'ok' ? 'text-ok' : onlineTone === 'bad' ? 'text-bad' : 'text-faint')}>{onlineTone === 'ok' ? 'online' : onlineTone === 'bad' ? 'offline' : 'unbekannt'}</span>
                  {ssh && <span className={cn('flex items-center gap-1 font-sans', authKey ? 'text-accent' : '')}>{authKey ? <KeyRound className="size-3.5" /> : <Lock className="size-3.5" />} {authKey ? 'Schlüssel' : 'Passwort'}</span>}
                  {running && live?.uptime ? <span className="font-sans">läuft seit {formatUptime(live.uptime)}</span> : null}
                </motion.p>
              </div>
            </div>
            <Stagger className="flex flex-wrap gap-2">
              {actions.map((action) => (
                <motion.button
                  key={action.label}
                  variants={staggerChild}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.96 }}
                  type="button"
                  onClick={action.onClick}
                  className={cn(
                    'flex h-10 items-center gap-2 rounded-full px-4 text-[13px] transition-colors',
                    'primary' in action && action.primary
                      ? 'bg-gradient-to-r from-accent-strong to-accent font-medium text-accent-ink shadow-[0_8px_24px_-10px_rgb(var(--accent)/0.9)]'
                      : 'border border-line/[0.12] bg-panel/60 backdrop-blur hover:border-accent/35 hover:bg-raised',
                  )}
                >
                  <action.icon className="size-4" /> {action.label}
                </motion.button>
              ))}
            </Stagger>
          </div>
        </div>
      </motion.div>

      {/* Top row */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
        <NotchCard index={0} glow className="min-h-[200px]" eyebrow={guest ? 'Proxmox · live alle 5 s' : guests.isLoading ? 'Proxmox' : 'Ressourcen'} title="Auslastung">
          {guest ? (
            <>
              <div className="mt-2 flex items-center justify-around">
                <Gauge value={cpu} label="CPU" sub={live?.cpus ? `${live.cpus} vCPU` : undefined} size={118} />
                <Gauge value={memory} label="RAM" sub={live?.maxmem ? formatBytes(live.maxmem) : undefined} size={118} />
              </div>
              {running && <div className="mt-2"><LiveSpark values={cpuSeries} max={Math.max(25, ...cpuSeries.map((value) => value * 1.3))} /></div>}
            </>
          ) : guests.isLoading ? (
            <div className="mt-4 flex justify-around"><Shimmer className="size-[110px] rounded-full" /><Shimmer className="size-[110px] rounded-full" /></div>
          ) : (
            <div className="mt-3 space-y-1 text-[12.5px] text-muted">
              <p>Kein Proxmox-Gast zugeordnet.</p>
              {f?.host.cpus && <p>{f.host.cpus} CPU-Kerne · {formatBytes((f.host.memoryKb ?? 0) * 1024)} RAM</p>}
              {f?.host.uptimeSeconds && <p>Uptime <span className="font-mono text-ink">{formatUptime(f.host.uptimeSeconds)}</span></p>}
            </div>
          )}
        </NotchCard>

        <NotchCard index={1} className="min-h-[200px]" eyebrow="Security-Prüfung" title="Absicherung" tone={audited && (audited.score ?? 100) < 55 ? 'bad' : undefined} onClick={() => navigate(`/security?guest=${encodeURIComponent(audited?.key ?? '')}`)} ariaLabel="Zur Security-Prüfung">
          {audited ? (
            <div className="mt-3 flex items-center gap-4">
              <Ring value={audited.score} size={96} stroke={9}>
                <span className={cn('text-[26px] font-bold', scoreTone(audited.score))}><AnimatedNumber value={audited.score} /></span>
              </Ring>
              <div className="space-y-1.5 text-[12.5px]">
                <p className="flex items-center gap-2 text-bad"><Beacon tone="bad" size={6} /> <AnimatedNumber value={audited.findings.filter((finding) => finding.status === 'fail').length} /> Mängel</p>
                <p className="flex items-center gap-2 text-accent"><Beacon tone="warn" size={6} /> <AnimatedNumber value={audited.findings.filter((finding) => finding.status === 'warn').length} /> zu prüfen</p>
                <p className="text-faint">Stand {audit.data?.last?.finishedAt ? formatRelative(audit.data.last.finishedAt) : '–'}</p>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[12.5px] text-muted">Noch nicht geprüft. <button type="button" onClick={() => navigate('/security')} className="text-accent hover:underline">Zur Security-Prüfung</button></p>
          )}
        </NotchCard>

        <WazuhCard index={2} connectionId={ssh ? connection.id : undefined} systemName={connection.name} facts={f} loading={facts.isLoading || facts.isFetching} error={(facts.error as Error | null)?.message} isWazuhServer={isWazuhServer} />

        <SarAgentCard index={2} connectionId={ssh ? connection.id : undefined} systemName={connection.name} />

        <NotchCard index={3} className="relative min-h-[200px]" eyebrow="Pakete" title="Updates" tone={security > 10 ? 'bad' : security ? 'warn' : undefined}>
          <ScanOverlay active={loadingFacts} />
          {f ? (
            <>
              <p className={cn('mt-3 text-[40px] font-bold leading-none tracking-[-0.03em]', security ? 'text-accent' : 'text-ok')}><AnimatedNumber value={f.upgradable.length} /></p>
              <p className="mt-1 text-[12.5px] text-muted">aktualisierbar{f.rebootRequired ? ' · Neustart nötig' : ''}</p>
              {f.upgradable.length > 0 && (
                <div className="mt-3">
                  <SplitBar parts={[{ value: security, color: 'rgb(var(--bad))', label: 'Sicherheit' }, { value: f.upgradable.length - security, color: 'rgb(var(--accent))', label: 'Sonstige' }]} />
                  <p className="mt-1.5 flex justify-between text-[11px] text-faint"><span className="text-bad">{security} Sicherheit</span><span>{f.upgradable.length - security} sonstige</span></p>
                </div>
              )}
              <p className="mt-2 text-[11.5px] text-faint">Automatisch: {f.unattended.installed ? (f.unattended.enabled ? 'an' : 'installiert, aus') : 'nicht installiert'}{f.aptListsAgeDays !== undefined ? ` · Listen ${f.aptListsAgeDays} T alt` : ''}</p>
            </>
          ) : loadingFacts ? (
            <div className="mt-4 space-y-2"><Shimmer className="h-9 w-20" /><Shimmer className="h-3 w-32" /><Shimmer className="h-2 w-full" /></div>
          ) : (
            <p className="mt-3 text-[12.5px] text-muted">{!ssh ? 'Windows: Updates nur im System selbst einsehbar.' : guest && guest.status !== 'running' ? 'Gast läuft nicht.' : (facts.error as Error | null)?.message ?? 'Nicht verfügbar.'}</p>
          )}
        </NotchCard>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* Left column */}
        <div className="space-y-5">
          {guest && (
            <NotchCard index={4} eyebrow="Verlauf" title="CPU & RAM" bodyClassName="pt-3">
              <div className="mb-3 flex justify-end"><TimeframeSwitch value={timeframe} onChange={setTimeframe} id="system-detail" /></div>
              <TimeChart
                data={chartData}
                timeframe={timeframe}
                max={100}
                format={percent}
                height={190}
                series={[
                  { key: 'cpu', label: 'CPU', color: 'rgb(var(--accent))' },
                  { key: 'mem', label: 'RAM', color: 'rgb(var(--info))' },
                ]}
              />
            </NotchCard>
          )}

          {audited && problems.length > 0 && (
            <NotchCard index={5} eyebrow={`${problems.length} offene Punkte`} title="Was zu tun ist" bodyClassName="pt-3" actions={[{ label: 'Alle Befunde', icon: <ShieldHalf />, onClick: () => navigate(`/security?guest=${encodeURIComponent(audited.key)}`) }]}>
              <Stagger className="space-y-1.5">
                {problems.slice(0, 8).map((finding) => (
                  <motion.ul key={finding.id} variants={staggerChild}>
                    <FindingRow finding={finding} />
                  </motion.ul>
                ))}
              </Stagger>
            </NotchCard>
          )}

          <WazuhEventsCard index={6} ip={connection.host} />

          {(f || loadingFacts) && (
            <NotchCard index={6} className="relative" eyebrow="Netzwerk" title={f ? `Offene Ports (${external.length})` : 'Offene Ports'} bodyClassName="pt-3">
              <ScanOverlay active={loadingFacts} />
              {f ? (
                <>
                  <Stagger className="grid gap-1.5 sm:grid-cols-2">
                    {external.map((entry) => (
                      <motion.div
                        key={`${entry.proto}-${entry.port}`}
                        variants={staggerChild}
                        whileHover={{ x: 2 }}
                        className="flex items-center gap-2.5 rounded-xl border border-line/[0.07] bg-raised/20 px-3 py-2 text-[12.5px]"
                      >
                        <Beacon tone="ok" size={6} />
                        <span className="font-mono">{entry.proto.toUpperCase()} {entry.port}</span>
                        <span className="truncate text-muted">{entry.process ?? PORT_NAMES[entry.port] ?? ''}</span>
                        <span className="ml-auto font-mono text-[11px] text-faint">{entry.address === '*' || entry.address === '0.0.0.0' || entry.address === '::' ? 'alle' : entry.address}</span>
                      </motion.div>
                    ))}
                  </Stagger>
                  {external.length === 0 && <p className="text-[12.5px] text-muted">Nichts lauscht nach außen.</p>}
                  {f.docker && f.docker.length > 0 && (
                    <>
                      <p className="mb-2 mt-4 text-[12px] font-medium text-muted">Docker-Container ({f.docker.length})</p>
                      <Stagger className="flex flex-wrap gap-1.5">
                        {f.docker.map((container) => (
                          <motion.span key={container.name} variants={staggerChild} className={cn('rounded-xl border px-2.5 py-1 font-mono text-[11.5px]', container.privileged ? 'border-bad/40 text-bad' : 'border-line/[0.10]')}>
                            {container.name}
                          </motion.span>
                        ))}
                      </Stagger>
                    </>
                  )}
                </>
              ) : (
                <div className="grid gap-1.5 sm:grid-cols-2">{Array.from({ length: 4 }, (_, index) => <Shimmer key={index} className="h-9" />)}</div>
              )}
            </NotchCard>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-5">
          <NotchCard
            index={7}
            className="relative"
            eyebrow={f ? `per SSH · ${formatRelative(f.collectedAt)}` : 'System'}
            title="System"
            bodyClassName="pt-2"
            actions={ssh ? [{ label: 'Neu lesen', icon: facts.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />, onClick: () => void facts.refetch() }] : []}
          >
            <ScanOverlay active={ssh && facts.isFetching} label={facts.isLoading ? 'Lese per SSH …' : 'Aktualisiere …'} />
            <Stagger as="dl" className="divide-y divide-line/[0.05]">
              <Row label="Betriebssystem" loading={loadingFacts}>{f?.os.pretty ?? guest?.ostype ?? '–'}</Row>
              <Row label="Kernel" mono loading={loadingFacts}>{f?.kernel ?? '–'}</Row>
              <Row label="Hostname" mono loading={loadingFacts}>{f?.host.hostname ?? '–'}</Row>
              <Row label="Architektur" mono loading={loadingFacts}>{f?.host.arch ?? '–'}</Row>
              <Row label="CPU / RAM" loading={loadingFacts}>{f?.host.cpus ? `${f.host.cpus} Kerne · ${formatBytes((f.host.memoryKb ?? 0) * 1024)}` : live?.cpus ? `${live.cpus} vCPU · ${formatBytes(live.maxmem ?? 0)}` : '–'}</Row>
              <Row label="Uptime" loading={loadingFacts}>{f?.host.uptimeSeconds ? formatUptime(f.host.uptimeSeconds) : '–'}</Row>
              <Row label="IP-Adressen" mono>{guest?.ips.join(', ') || connection.host}</Row>
              <Row label="Zeit synchron" loading={loadingFacts}>{f ? (f.timeSynced ? 'ja' : f.timeSynced === false ? 'nein' : '–') : '–'}</Row>
              <Row label="Angemeldet als" mono loading={loadingFacts}>{f ? `${f.user}${f.privilege === 'nosudo' ? ' (ohne sudo)' : f.privilege === 'sudo -n' ? ' (sudo)' : ''}` : connection.username}</Row>
            </Stagger>
            {facts.isError && <p className="mt-2 text-[12px] text-bad">{(facts.error as Error).message}</p>}
          </NotchCard>

          {f && (
            <NotchCard index={8} eyebrow="Speicher" title="Dateisysteme" bodyClassName="pt-3">
              <Stagger className="space-y-3">
                {f.disks.map((disk, index) => (
                  <motion.div key={disk.mount} variants={staggerChild}>
                    <div className="mb-1.5 flex justify-between text-[12px]">
                      <span className="truncate font-mono">{disk.mount}</span>
                      <span className="font-mono text-muted"><AnimatedNumber value={disk.usedPercent} /> %</span>
                    </div>
                    <FillBar value={disk.usedPercent} delay={0.2 + index * 0.12} />
                  </motion.div>
                ))}
              </Stagger>
              {f.failedUnits.length > 0 && <p className="mt-3 text-[12px] text-accent">Fehlgeschlagene Dienste: {f.failedUnits.join(', ')}</p>}
            </NotchCard>
          )}

          {f && (
            <NotchCard index={9} eyebrow="Zugänge" title="Benutzer & SSH" bodyClassName="pt-2">
              <Stagger as="dl" className="divide-y divide-line/[0.05]">
                <Row label="Login-Konten" mono>{f.loginUsers.join(', ') || '–'}</Row>
                <Row label="sudo" mono>{(f.groups.sudo ?? f.groups.wheel ?? []).join(', ') || 'niemand'}</Row>
                <Row label="docker-Gruppe" mono>{(f.groups.docker ?? []).join(', ') || '–'}</Row>
                <Row label="SSH-Schlüssel">{f.authorizedKeys.reduce((sum, entry) => sum + entry.count, 0)} hinterlegt</Row>
                <Row label="Root-Login">{f.sshd?.permitrootlogin ?? 'nur mit root lesbar'}</Row>
                <Row label="Passwort-Login">{f.sshd?.passwordauthentication ?? '–'}</Row>
                <Row label="fail2ban / CrowdSec">{['fail2ban', 'crowdsec'].filter((service) => f.services[service] === 'active').join(', ') || 'keins'}</Row>
              </Stagger>
            </NotchCard>
          )}
        </div>
      </div>
    </MotionConfig>
  );
}
